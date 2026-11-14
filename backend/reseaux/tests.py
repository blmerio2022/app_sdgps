"""Tests du module « Réseau de triangulation GPS » : projection, géométrie, algorithme,
API et portée RBAC (cf. docs/normes-reseau-triangulation-gps.md)."""
import math
import random
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Ssdgps

from . import normes as N
from .generation import (
    ErreurReseau, _aretes_des_triangles, _eplucher, _ponts, _qualite_triangle,
    _variante_quadrilateres, _variante_rattachement, evaluer, generer_reseau, justifier,
    recommander, suggerer_points,
)
from .geometrie import (
    angles_triangle, apex_equilateral, azimut_deg, centre_circonscrit, delaunay, distance,
    enveloppe_convexe,
)
from .projection import deviner_zone, lambert_vers_wgs84, wgs84_vers_lambert

User = get_user_model()
URL = '/api/v1/reseau-gps/'


def _pt(nom, x, y, statut='ancien'):
    return {'id': nom, 'nom_point': nom, 'x_m': x, 'y_m': y, 'reference': f'R-{nom}',
            'nature_materialisation': 'Borne', 'nature_signalisation': 'Peinture', 'statut': statut}


def _grille_triangulaire(nx=4, ny=4, pas=2000.0, x0=420000.0, y0=380000.0):
    """Semis « parfait » : réseau de triangles équilatéraux."""
    pts = []
    for j in range(ny):
        for i in range(nx):
            x = x0 + i * pas + (pas / 2 if j % 2 else 0)
            y = y0 + j * pas * math.sqrt(3) / 2
            pts.append(_pt(f'A{j}{i}', x, y))
    return pts


class ProjectionTests(SimpleTestCase):
    """Valeurs de référence calculées avec PROJ (EPSG:2619x + Merchich to WGS 84 (1))."""
    REFERENCES = [
        ('nord', 420000, 380000, 34.015908783935465, -6.264760093280916),
        ('nord', 500000, 300000, 33.29738117918213, -5.398408086977291),
        ('sud', 420000, 380000, 30.416917711849518, -6.231346687730643),
        ('sahara_nord', 1150000, 450000, 26.5484157817148, -5.900449097169448),
        ('sahara_sud', 1450000, 350000, 22.045685448801414, -5.883087922039268),
    ]

    def test_conforme_a_proj(self):
        for zone, x, y, lat, lon in self.REFERENCES:
            with self.subTest(zone=zone, x=x):
                la, lo = lambert_vers_wgs84(x, y, zone)
                self.assertAlmostEqual(la, lat, places=7)
                self.assertAlmostEqual(lo, lon, places=7)

    def test_aller_retour_centimetrique(self):
        for zone, x, y, _, _ in self.REFERENCES:
            lat, lon = lambert_vers_wgs84(x, y, zone)
            x2, y2 = wgs84_vers_lambert(lat, lon, zone)
            self.assertLess(math.hypot(x2 - x, y2 - y), 0.01)

    def test_deviner_zone(self):
        self.assertEqual(deviner_zone('Lambert Nord Maroc'), 'nord')
        self.assertEqual(deviner_zone('Zone 1'), 'nord')
        self.assertEqual(deviner_zone('Lambert zone II'), 'sud')
        self.assertEqual(deviner_zone('Sud'), 'sud')
        self.assertEqual(deviner_zone('Sahara Nord'), 'sahara_nord')
        self.assertEqual(deviner_zone('zone IV'), 'sahara_sud')
        self.assertIsNone(deviner_zone(''))
        self.assertIsNone(deviner_zone('WGS84'))


class GeometrieTests(SimpleTestCase):
    def test_angles_equilateral(self):
        a, b = (0, 0), (1000, 0)
        c = apex_equilateral(a, b)
        for ang in angles_triangle(a, b, c):
            self.assertAlmostEqual(ang, 60.0, places=6)

    def test_apex_cote_oppose(self):
        a, b = (0, 0), (10, 0)
        self.assertLess(apex_equilateral(a, b, cote_oppose=(5, 5))[1], 0)
        self.assertGreater(apex_equilateral(a, b, cote_oppose=(5, -5))[1], 0)

    def test_azimut(self):
        self.assertAlmostEqual(azimut_deg((0, 0), (0, 10)), 0.0)
        self.assertAlmostEqual(azimut_deg((0, 0), (10, 0)), 90.0)
        self.assertAlmostEqual(azimut_deg((0, 0), (0, -10)), 180.0)
        self.assertAlmostEqual(azimut_deg((0, 0), (-10, 0)), 270.0)

    def test_delaunay_cercle_vide_et_euler(self):
        random.seed(7)
        pts = [(420000 + random.random() * 8000, 380000 + random.random() * 8000) for _ in range(80)]
        tris = delaunay(pts)
        h = len(enveloppe_convexe(pts))
        self.assertEqual(len(tris), 2 * len(pts) - 2 - h)  # relation d'Euler
        for t in tris:
            a, b, c = (pts[i] for i in t)
            cc = centre_circonscrit(a, b, c)
            r = distance(cc, a)
            for k, p in enumerate(pts):
                if k not in t:
                    self.assertGreaterEqual(distance(cc, p), r * (1 - 1e-9))

    def test_delaunay_points_alignes(self):
        self.assertEqual(delaunay([(0, 0), (1, 1), (2, 2), (5, 5)]), [])

    def test_ponts(self):
        # Triangle 0-1-2 + queue 2-3 : la seule ligne hors boucle est 2-3.
        self.assertEqual(_ponts(4, {(0, 1), (1, 2), (0, 2), (2, 3)}), {(2, 3)})


class AlgorithmeTests(SimpleTestCase):
    def test_qualite_triangle(self):
        q = _qualite_triangle([(0, 0), (1000, 0), (500, 866.0254)], (0, 1, 2))
        self.assertTrue(q['conforme'])
        self.assertFalse(q['defectueux'])
        q = _qualite_triangle([(0, 0), (1000, 0), (500, 50)], (0, 1, 2))
        self.assertFalse(q['conforme'])
        self.assertTrue(q['defectueux'])

    def test_reseau_parfait_entierement_conforme(self):
        r = generer_reseau(_grille_triangulaire())
        reco = next(v for v in r['variantes'] if v['code'] == r['recommandee'])
        ind = reco['indicateurs']
        self.assertTrue(reco['admissible'])
        self.assertEqual(ind['taux_triangles_conformes'], 1.0)
        self.assertAlmostEqual(ind['angle_min'], 60.0, places=1)
        self.assertEqual(ind['taux_lignes_en_boucle'], 1.0)
        self.assertTrue(all(c['ok'] for c in reco['controles'] if c['gravite'] != 'mineur'))
        # Rien à suggérer : la géométrie est déjà idéale.
        self.assertEqual(r['parfaite']['suggestions'], [])

    def test_epluchage_retire_le_triangle_aplati_du_pourtour(self):
        # Base presque alignée + sommet lointain : trois triangles aplatis en éventail.
        coords = [(0, 0), (1000, -20), (2000, -20), (3000, 0), (1500, 8000)]
        tris = delaunay(coords)
        self.assertEqual(tris, [(0, 1, 4), (1, 2, 4), (2, 3, 4)])
        self.assertTrue(all(_qualite_triangle(coords, t)['defectueux'] for t in tris))
        epure = _eplucher(coords, tris, N.ANGLE_MIN_TOLERE, N.ANGLE_MAX_TOLERE, 10_000)
        # Le triangle central part ; les deux autres restent, sinon un point serait isolé (N5).
        self.assertEqual(epure, [(0, 1, 4), (2, 3, 4)])
        self.assertEqual({s for t in epure for s in t}, set(range(len(coords))))

    def test_epluchage_ne_scinde_pas_le_reseau(self):
        coords = [(0, 0), (1000, 0), (500, 30)]  # unique triangle, défectueux
        self.assertEqual(_eplucher(coords, delaunay(coords), 20, 150, 10_000), [(0, 1, 2)])

    def test_quadrilateres_ajoutent_des_diagonales(self):
        coords = [(0, 0), (1000, 0), (1000, 1000), (0, 1000)]
        aretes = _variante_quadrilateres(coords, longueur_max_m=10_000)
        self.assertEqual(len(aretes), 6)  # 4 côtés + 2 diagonales

    def test_rattachement_relie_chaque_nouveau_a_3_anciens(self):
        coords = [(0, 0), (4000, 0), (4000, 4000), (0, 4000), (2000, 2000), (2500, 1800)]
        statuts = ['ancien'] * 4 + ['nouveau'] * 2
        aretes = _variante_rattachement(coords, statuts=statuts, longueur_max_m=10_000)
        for nv in (4, 5):
            anciens_lies = {a for e in aretes if nv in e for a in e if a != nv and a < 4}
            self.assertGreaterEqual(len(anciens_lies), 3)
        self.assertIn((4, 5), aretes)

    def test_ligne_trop_longue_signalee(self):
        coords = [(0, 0), (20_000, 0), (10_000, 17_320)]
        ev = evaluer(coords, ['ancien'] * 3, _aretes_des_triangles(delaunay(coords)), 10_000, 'anciens')
        self.assertEqual(ev['indicateurs']['nb_lignes_trop_longues'], 3)
        ctrl = next(c for c in ev['controles'] if c['code'] == 'LONGUEUR')
        self.assertFalse(ctrl['ok'])
        self.assertTrue(all(lg['trop_longue'] for lg in ev['lignes']))

    def test_point_a_une_seule_liaison_non_admissible(self):
        coords = [(0, 0), (1000, 0), (500, 866), (500, 3000)]
        aretes = {(0, 1), (1, 2), (0, 2), (2, 3)}
        ev = evaluer(coords, ['ancien'] * 4, aretes, 10_000, 'anciens')
        self.assertFalse(ev['admissible'])
        self.assertEqual(ev['indicateurs']['redondance'], 1)
        self.assertLess(ev['indicateurs']['taux_lignes_en_boucle'], 1)

    def test_regle_stations_voisines(self):
        # 0 et 3 sont à 100 m mais reliés seulement par un long détour.
        coords = [(0, 0), (0, 3000), (100, 3000), (100, 0)]
        aretes = {(0, 1), (1, 2), (2, 3)}
        ev = evaluer(coords, ['ancien'] * 4, aretes, 10_000, 'anciens')
        self.assertIn([0, 3], ev['violations_stations_voisines'])

    def test_recommandation_prefere_le_meilleur_score_admissible(self):
        variantes = [
            {'code': 'a', 'nom': 'A', 'admissible': True, 'controles': [],
             'indicateurs': {'score': 70, 'nb_lignes_base': 20}},
            {'code': 'b', 'nom': 'B', 'admissible': False, 'controles': [],
             'indicateurs': {'score': 90, 'nb_lignes_base': 10}},
            {'code': 'c', 'nom': 'C', 'admissible': True, 'controles': [],
             'indicateurs': {'score': 70, 'nb_lignes_base': 15}},
        ]
        self.assertEqual(recommander(variantes), 'c')  # égalité → moins de lignes
        self.assertIsNone(recommander([variantes[1]]))

    def test_justification_cite_la_comparaison(self):
        random.seed(11)
        pts = [_pt(f'A{i}', 420000 + random.random() * 6000, 380000 + random.random() * 6000)
               for i in range(14)]
        r = generer_reseau(pts)
        self.assertIsNotNone(r['recommandee'])
        texte = ' '.join(r['justification'])
        self.assertIn('Meilleur score', texte)
        self.assertIn('Angle minimal', texte)
        self.assertEqual(sum(1 for v in r['variantes'] if v['recommandee']), 1)

    def test_justification_sans_variante_admissible(self):
        r = generer_reseau([_pt('A', 0, 0), _pt('B', 100, 100), _pt('C', 200, 200)])
        self.assertIsNone(r['recommandee'])
        self.assertIn("Aucune variante", r['justification'][0])

    def test_variantes_du_reseau_mixte(self):
        pts = _grille_triangulaire(3, 3) + [_pt('N1', 422500, 381500, 'nouveau'),
                                            _pt('N2', 421500, 381200, 'nouveau')]
        r = generer_reseau(pts, type_reseau='mixte')
        codes = [v['code'] for v in r['variantes']]
        self.assertIn('rattachement', codes)
        self.assertEqual(r['points'][-1]['statut'], 'nouveau')
        delaunay_v = next(v for v in r['variantes'] if v['code'] == 'delaunay')
        self.assertIn('quadrants_anciens', delaunay_v['indicateurs'])
        self.assertEqual(delaunay_v['indicateurs']['nb_nouveaux_hors_enveloppe'], 0)

    def test_reseau_anciens_ignore_les_nouveaux(self):
        pts = _grille_triangulaire(3, 2) + [_pt('N1', 421000, 381000, 'nouveau')]
        r = generer_reseau(pts, type_reseau='anciens')
        self.assertEqual(len(r['points']), 6)

    def test_mixte_exige_un_nouveau_et_3_anciens(self):
        with self.assertRaises(ErreurReseau):
            generer_reseau(_grille_triangulaire(2, 2), type_reseau='mixte')
        r = generer_reseau([_pt('A', 0, 0), _pt('B', 3000, 0), _pt('N', 1500, 2000, 'nouveau')],
                           type_reseau='mixte')
        self.assertIsNone(r['recommandee'])  # 2 anciens seulement → bloquant N10

    def test_erreurs_de_saisie(self):
        with self.assertRaises(ErreurReseau):
            generer_reseau([_pt('A', 0, 0), _pt('B', 1, 1)])
        with self.assertRaises(ErreurReseau):
            generer_reseau([_pt('A', 0, 0), _pt('B', 0, 0), _pt('C', 5, 5)])
        with self.assertRaises(ErreurReseau):
            generer_reseau([_pt('A', 0, 0), _pt('B', 100, 0), {'nom_point': 'C', 'x_m': 'abc', 'y_m': 1}])

    def test_variante_parfaite_ameliore_le_score(self):
        # Triangle très aplati : la variante parfaite doit suggérer des emplacements.
        pts = [_pt('A', 420000, 380000), _pt('B', 426000, 380000), _pt('C', 423000, 380600),
               _pt('D', 423000, 383500)]
        r = generer_reseau(pts, nb_suggestions_max=4)
        p = r['parfaite']
        self.assertGreater(len(p['suggestions']), 0)
        s0 = p['suggestions'][0]
        self.assertGreater(s0['score_apres'], s0['score_avant'])
        self.assertGreater(s0['rayon_recherche_m'], 0)
        self.assertIn('Rechercher un point ancien', s0['justification'])
        self.assertTrue(-90 < s0['lat'] < 90)
        self.assertEqual(p['points'][s0['index']]['statut'], 'suggere')
        delaunay_v = next(v for v in r['variantes'] if v['code'] == 'delaunay')
        self.assertGreaterEqual(p['indicateurs']['score'], delaunay_v['indicateurs']['score'])

    def test_points_alignes_suggestions(self):
        coords = [(0, 0), (1000, 0), (2000, 0)]
        pts = [_pt(n, *c) for n, c in zip('ABC', coords)]
        _, crd, _, sugg = suggerer_points(pts, coords, ['ancien'] * 3, 10_000, 'anciens', 3)
        self.assertGreater(len(sugg), 0)
        self.assertTrue(delaunay(crd))

    def test_sortie_points_et_lignes(self):
        r = generer_reseau(_grille_triangulaire(3, 2), zone='nord')
        p0 = r['points'][0]
        for cle in ('nom_point', 'reference', 'nature_materialisation', 'nature_signalisation',
                    'lat', 'lon', 'degre'):
            self.assertIn(cle, p0)
        lg = r['variantes'][0]['lignes'][0]
        self.assertAlmostEqual(lg['distance_km'], 2.0, places=3)
        self.assertIn('azimut_deg', lg)
        self.assertEqual(len(r['variantes'][0]['triangles'][0]['angles_deg']), 3)

    def test_justifier_sans_admissible_liste_les_causes(self):
        v = [{'code': 'x', 'nom': 'X', 'admissible': False, 'indicateurs': {},
              'controles': [{'gravite': 'bloquant', 'ok': False, 'message': 'Réseau scindé'}]}]
        self.assertIn('X : Réseau scindé', justifier(v, None))


class ApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-R', name='Org Réseau')
        self.autre = Organization.objects.create(code='ORG-S', name='Autre')
        self.agent = self._user('agent@sdgps.ma', self.org, 'ROLE_ORGANISATION_AGENT')
        self.admin_org = self._user('adm@sdgps.ma', self.org, 'ROLE_ORGANISATION_ADMIN')
        self.intrus = self._user('intrus@sdgps.ma', self.autre, 'ROLE_ORGANISATION_AGENT')
        self.sys = User.objects.create_user(username='sys@sdgps.ma', email='sys@sdgps.ma',
                                            password='x', platform_role='ROLE_ADMIN_SYSTEME')
        self.root = User.objects.create_superuser(username='root@sdgps.ma', email='root@sdgps.ma',
                                                  password='x')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-RES', organization=self.org)
        prop = Propriete.objects.create(nom_propriete='Prop', id_titre='T1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                     nature_affaire='BI', propriete=prop,
                                     date_bornage=datetime(2024, 1, 1, tzinfo=dt_timezone.utc))
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='DDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='mono-session', affaire=aff)
        rows = [{'id': '1', 'nom_point': 'B1', 'x_m': 420000, 'y_m': 380000, 'reference': 'R1',
                 'nature_materialisation': 'Borne', 'nature_signalisation': 'Peinture'},
                {'id': '2', 'nom_point': 'B2', 'x_m': 423000, 'y_m': 380000},
                {'id': '3', 'nom_point': 'B3', 'x_m': 421500, 'y_m': 382600}]
        Piece.objects.create(type_piece='LPA', ssdgps=self.ssdgps, payload={'rows': rows})
        Piece.objects.create(type_piece='PPA', ssdgps=self.ssdgps,
                             payload={'rows': [{'nom_point': 'B1', 'zone_projection': 'Lambert Sud'}]})

    @staticmethod
    def _user(email, org, role):
        u = User.objects.create_user(username=email, email=email, password='x')
        Membership.objects.create(user=u, organization=org, role=role)
        return u

    def _payload(self, **extra):
        return {'points': [_pt('A', 420000, 380000), _pt('B', 423000, 380000),
                           _pt('C', 421500, 382600), _pt('D', 424500, 382600)], **extra}

    def test_anonyme_refuse(self):
        self.assertEqual(self.client.get(URL + 'referentiel/').status_code, 401)
        self.assertEqual(self.client.post(URL + 'generer/', self._payload(), format='json').status_code, 401)
        self.assertEqual(self.client.get(URL + 'sources-lpa/').status_code, 401)

    def test_tous_les_roles_peuvent_generer(self):
        for user in (self.agent, self.admin_org, self.sys, self.root):
            with self.subTest(user=user.email):
                self.client.force_authenticate(user)
                resp = self.client.post(URL + 'generer/', self._payload(zone='nord'), format='json')
                self.assertEqual(resp.status_code, 200, resp.data)
                self.assertIn('variantes', resp.data)
                self.assertIn('parfaite', resp.data)
                self.assertTrue(resp.data['justification'])

    def test_referentiel(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get(URL + 'referentiel/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual({z['code'] for z in resp.data['zones']},
                         {'nord', 'sud', 'sahara_nord', 'sahara_sud'})
        self.assertEqual(resp.data['defauts']['longueur_max_km'], 10.0)
        self.assertTrue(any(n['code'] == 'N7' for n in resp.data['normes']))

    def test_validation(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.post(URL + 'generer/', self._payload(zone='lune'), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('zone', resp.data)
        resp = self.client.post(URL + 'generer/', self._payload(longueur_max_km=0), format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(URL + 'generer/', {'points': [_pt('A', 0, 0)]}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('detail', resp.data)

    def test_sources_lpa_filtrees_par_portee(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get(URL + 'sources-lpa/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([s['ssdgps_id'] for s in resp.data], [str(self.ssdgps.id)])
        self.assertEqual(resp.data[0]['nb_points'], 3)
        self.client.force_authenticate(self.intrus)
        self.assertEqual(self.client.get(URL + 'sources-lpa/').data, [])
        self.client.force_authenticate(self.sys)
        self.assertEqual(len(self.client.get(URL + 'sources-lpa/').data), 1)

    def test_detail_lpa_et_zone_proposee(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get(f'{URL}sources-lpa/{self.ssdgps.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['points']), 3)
        self.assertEqual(resp.data['points'][0]['nature_materialisation'], 'Borne')
        self.assertEqual(resp.data['points'][0]['statut'], 'ancien')
        self.assertEqual(resp.data['zone_proposee'], 'sud')

    def test_detail_lpa_hors_portee_404(self):
        self.client.force_authenticate(self.intrus)
        resp = self.client.get(f'{URL}sources-lpa/{self.ssdgps.id}/')
        self.assertEqual(resp.status_code, 404)

    def test_lpa_supprimee_ignoree(self):
        Piece.objects.filter(type_piece='LPA').update(is_deleted=True)
        self.client.force_authenticate(self.agent)
        self.assertEqual(self.client.get(URL + 'sources-lpa/').data, [])


class FormatageTests(SimpleTestCase):
    def test_arrondi_comme_l_ecran(self):
        from .generation import _fmt
        self.assertEqual(_fmt(75.55), '75,6')
        self.assertEqual(_fmt(7.6923, 3), '7,692')
        self.assertEqual(_fmt(12, 0), '12')

    def test_points_de_vigilance_sans_double_ponctuation(self):
        v = [{'code': 'a', 'nom': 'A', 'admissible': True,
              'indicateurs': {'score': 50, 'angle_min': 20, 'taux_triangles_conformes': 0.5,
                              'ecart_equilateral_moyen': 10, 'redondance': 1,
                              'taux_lignes_en_boucle': 1, 'nb_lignes_base': 3,
                              'lignes_par_point': 1, 'longueur_max_km': 2},
              'controles': [{'gravite': 'majeur', 'ok': False, 'message': 'Deux triangles.'},
                            {'gravite': 'mineur', 'ok': False, 'message': 'Un point.'}]}]
        derniere = justifier(v, 'a')[-1]
        self.assertEqual(derniere, 'Points de vigilance : Deux triangles ; Un point.')
