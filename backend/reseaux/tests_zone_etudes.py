"""Réseau GNSS — génération pour une zone, études enregistrées (personnelles)."""
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase

from .generation import ErreurReseau
from .models import EtudeReseau
from .tests import URL, ApiTests, _pt
from .zone_reseau import centre_zone, distance_a_la_zone, generer_pour_zone, quadrant
from .densification import Region

User = get_user_model()

# Zone carrée de 4 km ; points anciens autour (8 à moins de 3 km, 2 lointains) et 1 dedans.
ZONE = [[[[420000, 380000], [420000, 384000], [424000, 384000], [424000, 380000]]]]
POINTS = [
    _pt('NE', 425500, 385500), _pt('NO', 418500, 385500), _pt('SO', 418500, 378500), _pt('SE', 425500, 378500),
    _pt('N', 422000, 386000), _pt('S', 422000, 378000), _pt('E', 426000, 382000), _pt('O', 418000, 382000),
    _pt('DEDANS', 422100, 382100), _pt('LOIN1', 450000, 382000), _pt('LOIN2', 380000, 300000),
]


class OutilsZoneTests(SimpleTestCase):
    def test_distance_centre_quadrant(self):
        r = Region(ZONE)
        self.assertEqual(distance_a_la_zone((422000, 382000), r), 0)
        self.assertAlmostEqual(distance_a_la_zone((426000, 382000), r), 2000)
        self.assertAlmostEqual(distance_a_la_zone((425000, 385000), r), 2 ** 0.5 * 1000)
        cx, cy = centre_zone(r)
        self.assertAlmostEqual(cx, 422000)
        self.assertAlmostEqual(cy, 382000)
        self.assertEqual(quadrant((423000, 383000), (cx, cy)), 'nord-est')
        self.assertEqual(quadrant((421000, 381000), (cx, cy)), 'sud-ouest')


class GenerationZoneTests(SimpleTestCase):
    def test_triangulation_encadre_la_zone_et_ecarte_les_points_lointains(self):
        r = generer_pour_zone(POINTS, ZONE, mode='triangulation', rayon_recherche_km=3)
        retenus = set(r['anciens_retenus'])
        self.assertIn('DEDANS', retenus)
        self.assertTrue({'NE', 'NO', 'SO', 'SE'} & retenus)
        self.assertEqual(len(r['quadrants']), 4)
        self.assertFalse({'LOIN1', 'LOIN2'} & retenus)
        motifs = {d['nom_point']: d for d in r['details']}
        self.assertIn('rayon de recherche', motifs['LOIN1']['motif'])
        self.assertIn('Dans la zone', motifs['DEDANS']['motif'])
        self.assertEqual(r['nb_candidats'], 9)
        self.assertGreater(r['part_zone_encadree'], 0.9)
        self.assertIn('variantes', r['reseau'])
        self.assertGreater(r['score'], 0)
        self.assertIn('retenu(s)', r['conclusion'])

    def test_densification_place_les_points_nouveaux_dans_la_zone(self):
        r = generer_pour_zone(POINTS, ZONE, mode='densification', rayon_recherche_km=3, nb_nouveaux=2)
        nouveaux = [p for p in r['densification']['points'] if p['statut'] == 'nouveau']
        self.assertEqual(len(nouveaux), 2)
        for p in nouveaux:
            self.assertTrue(420000 <= p['x_m'] <= 424000 and 380000 <= p['y_m'] <= 384000)
        self.assertEqual(r['densification']['zones_utilisees'], {'densification': 1, 'levee': 1})

    def test_plafond_d_anciens_et_erreurs(self):
        r = generer_pour_zone(POINTS, ZONE, mode='triangulation', rayon_recherche_km=3, anciens_max=4)
        self.assertLessEqual(len(r['anciens_retenus']), 4)
        with self.assertRaisesMessage(ErreurReseau, 'Élargissez le rayon'):
            generer_pour_zone(POINTS[:2], ZONE, rayon_recherche_km=3)
        with self.assertRaisesMessage(ErreurReseau, 'Aucune zone'):
            generer_pour_zone(POINTS, [])
        with self.assertRaises(ErreurReseau):
            generer_pour_zone(POINTS, ZONE, mode='autre')
        r = generer_pour_zone(POINTS + [{'nom_point': 'X', 'x_m': 'abc', 'y_m': 1}], ZONE, mode='triangulation',
                              rayon_recherche_km=3)
        self.assertEqual(r['ignores'], ['X'])


class ApiZoneEtudesTests(ApiTests):
    def test_generer_zone_par_api(self):
        self.client.force_authenticate(self.agent)
        r = self.client.post(f'{URL}generer-zone/', {'anciens': POINTS, 'zones': ZONE, 'mode': 'triangulation',
                                                     'rayon_recherche_km': 3, 'nom_zone': 'Secteur'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['nom_zone'], 'Secteur')
        r = self.client.post(f'{URL}generer-zone/', {'anciens': POINTS[:2], 'zones': ZONE}, format='json')
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f'{URL}generer-zone/', {'anciens': POINTS, 'zones': [[['x']]]}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_etudes_crud_personnelles(self):
        self.client.force_authenticate(self.agent)
        contenu = {'anciens': [{'nom_point': 'A'}, {'nom_point': 'B'}], 'zones': [{'nom': 'Z'}], 'nouveaux': []}
        r = self.client.post(f'{URL}etudes/', {'nom': '  Azilal nord ', 'dossier': 'Azilal', 'contenu': contenu},
                             format='json')
        self.assertEqual(r.status_code, 201, r.data)
        eid = r.data['id']
        self.assertEqual((r.data['nom'], r.data['nb_points'], r.data['nb_zones']), ('Azilal nord', 2, 1))
        self.client.post(f'{URL}etudes/', {'nom': 'Demnate', 'contenu': {}}, format='json')
        liste = self.client.get(f'{URL}etudes/').data
        self.assertEqual(len(liste['etudes']), 2)
        self.assertNotIn('contenu', liste['etudes'][0])
        self.assertEqual(liste['dossiers'], ['Azilal'])
        self.assertEqual(len(self.client.get(f'{URL}etudes/?dossier=Azilal').data['etudes']), 1)
        self.assertEqual(len(self.client.get(f'{URL}etudes/?q=demn').data['etudes']), 1)
        # Lecture complète, mise à jour du contenu (compteurs recalculés), épinglage.
        self.assertEqual(self.client.get(f'{URL}etudes/{eid}/').data['contenu'], contenu)
        r = self.client.patch(f'{URL}etudes/{eid}/', {'contenu': {'anciens': [{}], 'zones': [], 'nouveaux': [{}]},
                                                      'epinglee': True}, format='json')
        self.assertEqual((r.data['nb_points'], r.data['nb_zones'], r.data['nb_nouveaux'], r.data['epinglee']),
                         (1, 0, 1, True))
        self.assertEqual(self.client.get(f'{URL}etudes/').data['etudes'][0]['id'], eid)   # épinglée en tête
        # Duplication, suppression logique.
        r = self.client.post(f'{URL}etudes/{eid}/dupliquer/')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['nom'], 'Azilal nord (copie)')
        self.assertEqual(self.client.delete(f'{URL}etudes/{eid}/').status_code, 204)
        self.assertTrue(EtudeReseau.objects.get(pk=eid).is_deleted)
        self.assertEqual(self.client.get(f'{URL}etudes/{eid}/').status_code, 404)
        # Validation.
        self.assertEqual(self.client.post(f'{URL}etudes/', {'nom': '  ', 'contenu': {}}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'{URL}etudes/', {'nom': 'x', 'contenu': []}, format='json').status_code, 400)

    def test_une_etude_est_strictement_personnelle(self):
        self.client.force_authenticate(self.agent)
        eid = self.client.post(f'{URL}etudes/', {'nom': 'Mienne', 'contenu': {}}, format='json').data['id']
        for autre in (self.admin_org, self.sys, self.root):
            self.client.force_authenticate(autre)
            self.assertEqual(self.client.get(f'{URL}etudes/{eid}/').status_code, 404)
            self.assertEqual(self.client.patch(f'{URL}etudes/{eid}/', {'nom': 'x'}, format='json').status_code, 404)
            self.assertEqual(self.client.delete(f'{URL}etudes/{eid}/').status_code, 404)
            self.assertEqual(self.client.get(f'{URL}etudes/').data['etudes'], [])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'{URL}etudes/').status_code, 401)


class RayonDeplacementTests(SimpleTestCase):
    ANCIENS = [_pt('A', 420000, 380000), _pt('B', 428000, 380000), _pt('C', 424000, 387000),
               _pt('D', 416000, 386000), _pt('E', 432000, 386000)]

    def test_rayon_calcule_lors_d_une_proposition_seulement(self):
        from .densification import RAYONS_ESSAIS_M, densifier
        r = densifier(self.ANCIENS, nb_nouveaux=3)
        nouveaux = [p for p in r['points'] if p['statut'] == 'nouveau']
        self.assertEqual(len(nouveaux), 3)
        for p in nouveaux:
            self.assertIn(p['rayon_deplacement_m'], (0,) + RAYONS_ESSAIS_M)
        self.assertTrue(any(p['rayon_deplacement_m'] > 0 for p in nouveaux))
        # Évaluation d'un déplacement : pas de recalcul (rapide) sauf demande explicite.
        fixes = [{k: v for k, v in p.items() if k != 'rayon_deplacement_m'} for p in nouveaux]
        r2 = densifier(self.ANCIENS, fixes, proposer=False)
        self.assertNotIn('rayon_deplacement_m', [k for p in r2['points'] for k in p])
        r3 = densifier(self.ANCIENS, fixes, proposer=False, rayons=True)
        self.assertTrue(all('rayon_deplacement_m' in p for p in r3['points'] if p['statut'] == 'nouveau'))

    def test_rayon_respecte_la_tolerance_de_score(self):
        from .densification import (
            ECHANTILLONS_CIBLE, Region, TOLERANCE_SCORE_RAYON, _evaluer, _grille, rayons_deplacement,
        )
        from .densification import densifier
        r = densifier(self.ANCIENS, nb_nouveaux=2)
        pts = r['points']
        coords = [(p['x_m'], p['y_m']) for p in pts]
        statuts = [p['statut'] for p in pts]
        env = Region([[[(p['x_m'], p['y_m']) for p in (self.ANCIENS[0], self.ANCIENS[1], self.ANCIENS[4],
                                                         self.ANCIENS[2], self.ANCIENS[3])]]])
        ech, _ = _grille(env, ECHANTILLONS_CIBLE)
        s0, _, t0, _, _ = _evaluer(coords, statuts, 10000, ech, 5000, 3)
        idx = [k for k, s in enumerate(statuts) if s == 'nouveau']
        from .densification import _variante_toleree
        aretes = set(_variante_toleree(coords, longueur_max_m=10000))
        s0, _, t0, _, _ = _evaluer(coords, statuts, 10000, ech, 5000, 3, aretes=aretes)
        rayons = rayons_deplacement(coords, statuts, idx, 10000, ech, 5000, 3, aretes=aretes)
        for k, rayon in rayons.items():
            if rayon:
                essai = list(coords)
                essai[k] = (coords[k][0] + rayon, coords[k][1])
                s, _, _, _, _ = _evaluer(essai, statuts, 10000, ech, 5000, 3, aretes=aretes)
                self.assertGreaterEqual(s, s0 - TOLERANCE_SCORE_RAYON - 1e-6)
