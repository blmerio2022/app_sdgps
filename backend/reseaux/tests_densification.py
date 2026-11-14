"""Tests du module Réseau GPS — optimisation du réseau de contrôle, écarts du rapport de
contrôle (points homogènes), densification (norme N11 de couverture), catalogue de fonds."""
import math

from django.test import SimpleTestCase

from pieces.models import Piece

from .densification import ErreurDensification, couverture, densifier
from .ecarts import ErreurEcarts, analyser_ecarts, lire_lignes_rc
from .fonds import CATALOGUE, CATEGORIES, FONDS_PAR_DEFAUT
from .generation import generer_reseau
from .optimisation import suggerer_suppressions
from .tests import URL, ApiTests, _grille_triangulaire, _pt


def _rc(paires):
    """Lignes RC dans les deux sens à partir de {(fixe, calcule): ΔD}."""
    lignes = []
    for (a, b), dd in paires.items():
        lignes.append({'nom_point_fixe': a, 'nom_point_calcule': b, 'delta_d_m': dd})
        lignes.append({'nom_point_fixe': b, 'nom_point_calcule': a, 'delta_d_m': dd})
    return lignes


class SuppressionsTests(SimpleTestCase):
    def test_points_quasi_confondus(self):
        pts = _grille_triangulaire(3, 3) + [_pt('DOUBLON', 420010, 380005)]
        coords = [(p['x_m'], p['y_m']) for p in pts]
        sugg = suggerer_suppressions(pts, coords, ['ancien'] * len(pts), 10_000, 'anciens')
        self.assertTrue(sugg)
        self.assertEqual(sugg[0]['type'], 'proximite')
        self.assertIn(sugg[0]['nom_point'], ('DOUBLON', 'A00'))
        self.assertIn('Score de conformité', sugg[0]['justification'])

    def test_reseau_parfait_sans_suppression(self):
        # Hexagone régulier + centre : six triangles équilatéraux, aucun point à écarter.
        pts = [_pt('C', 0, 0)] + [_pt(f'H{k}', 2000 * math.cos(k * math.pi / 3),
                                      2000 * math.sin(k * math.pi / 3)) for k in range(6)]
        coords = [(p['x_m'], p['y_m']) for p in pts]
        self.assertEqual(suggerer_suppressions(pts, coords, ['ancien'] * 7, 10_000, 'anciens'), [])

    def test_jamais_sous_trois_anciens(self):
        pts = [_pt('A', 0, 0), _pt('B', 3000, 0), _pt('C', 1500, 2600)]
        coords = [(p['x_m'], p['y_m']) for p in pts]
        self.assertEqual(suggerer_suppressions(pts, coords, ['ancien'] * 3, 10_000, 'anciens'), [])

    def test_generer_renvoie_les_suppressions(self):
        r = generer_reseau(_grille_triangulaire(3, 3) + [_pt('DOUBLON', 420010, 380005)])
        self.assertTrue(r['suppressions'])


class EcartsTests(SimpleTestCase):
    def test_detection_du_groupe_homogene(self):
        lignes = _rc({('A', 'B'): 0.05, ('A', 'C'): 0.08, ('B', 'C'): 0.06,
                      ('A', 'D'): 0.40, ('B', 'D'): 0.35, ('C', 'D'): 0.30})
        a = analyser_ecarts(lignes, 0.15)
        self.assertEqual(a['homogenes'], ['A', 'B', 'C'])
        self.assertEqual(a['non_homogenes'], ['D'])
        d = next(p for p in a['points'] if p['nom_point'] == 'D')
        self.assertEqual(d['nb_hors_tolerance'], 3)
        self.assertFalse(d['homogene'])
        self.assertEqual(a['nb_hors_tolerance'], 6)
        self.assertIn('D présente', a['conclusion'])

    def test_tolerance_parametrable(self):
        lignes = _rc({('A', 'B'): 0.05, ('A', 'C'): 0.20, ('B', 'C'): 0.18})
        self.assertEqual(len(analyser_ecarts(lignes, 0.15)['homogenes']), 2)
        self.assertEqual(analyser_ecarts(lignes, 0.25)['homogenes'], ['A', 'B', 'C'])

    def test_pire_des_deux_sens(self):
        lignes = [{'nom_point_fixe': 'A', 'nom_point_calcule': 'B', 'delta_d_m': '0,05'},
                  {'nom_point_fixe': 'B', 'nom_point_calcule': 'A', 'delta_d_m': '0,30'},
                  {'nom_point_fixe': 'A', 'nom_point_calcule': 'C', 'delta_d_m': '0,02'}]
        self.assertNotIn('B', analyser_ecarts(lignes, 0.15)['homogenes'])

    def test_delta_recalcule_depuis_les_coordonnees(self):
        rows = lire_lignes_rc([{'nom_point_fixe': 'A', 'nom_point_calcule': 'B', 'x_m_fixe': '100',
                                'y_m_fixe': '200', 'x_m_calcule': '100,06', 'y_m_calcule': '200,08'}])
        self.assertAlmostEqual(rows[0]['dd'], 0.1, places=6)

    def test_rc_sans_ligne_exploitable(self):
        with self.assertRaises(ErreurEcarts):
            analyser_ecarts([{'nom_point_fixe': 'A', 'nom_point_calcule': 'A', 'delta_d_m': '--'}])

    def test_points_du_reseau_non_controles(self):
        a = analyser_ecarts(_rc({('A', 'B'): 0.01, ('A', 'C'): 0.01, ('B', 'C'): 0.01}), 0.15,
                            noms_reseau=['A', 'B', 'C', 'Z'])
        self.assertEqual(a['non_controles'], ['Z'])


class DensificationTests(SimpleTestCase):
    # Carré de 10 km : la couverture N11 (3 points à moins de 5 km) exige des points nouveaux.
    ANCIENS = [_pt('A', 420000, 380000), _pt('B', 430000, 380000), _pt('C', 430000, 390000),
               _pt('D', 420000, 390000)]

    def test_couverture(self):
        taux, non, progressif = couverture([(100, 100), (9000, 9000)], [(0, 0), (1000, 0), (0, 1000)],
                                           5000, 3)
        self.assertEqual(taux, 0.5)
        self.assertEqual(non, [1])
        self.assertEqual(progressif, 0.5)  # 3/3 pour le premier, 0/3 pour le second
        _, _, partiel = couverture([(100, 100)], [(0, 0)], 5000, 3)
        self.assertAlmostEqual(partiel, 1 / 3)

    def test_proposition_automatique_couvre_la_zone(self):
        r = densifier(self.ANCIENS, nb_nouveaux=0)
        self.assertGreater(len(r['proposes']), 0)
        self.assertEqual(r['couverture']['taux'], 1.0)
        self.assertTrue(any(c['code'] == 'COUVERTURE' and c['ok'] for c in r['reseau']['controles']))
        p = r['points'][r['proposes'][0]]
        self.assertEqual(p['statut'], 'nouveau')
        self.assertEqual(p['origine'], 'propose')
        self.assertTrue(p['nom_point'].startswith('PN'))

    def test_nombre_impose_et_points_manuels_conserves(self):
        r = densifier(self.ANCIENS, [_pt('M1', 425000, 385000, 'nouveau')], nb_nouveaux=2)
        self.assertEqual(len(r['proposes']), 2)
        m1 = next(p for p in r['points'] if p['nom_point'] == 'M1')
        self.assertEqual((m1['x_m'], m1['y_m']), (425000.0, 385000.0))
        self.assertEqual(m1['origine'], 'manuel')

    def test_les_propositions_ameliorent_le_score(self):
        avant = densifier(self.ANCIENS, proposer=False)
        apres = densifier(self.ANCIENS, nb_nouveaux=3)
        self.assertEqual(avant['proposes'], [])
        self.assertGreater(apres['score'], avant['score'])
        self.assertGreater(apres['couverture']['taux'], avant['couverture']['taux'])

    def test_points_proposes_dans_la_zone(self):
        r = densifier(self.ANCIENS, nb_nouveaux=4)
        for i in r['proposes']:
            p = r['points'][i]
            self.assertTrue(420000 <= p['x_m'] <= 430000 and 380000 <= p['y_m'] <= 390000)

    def test_erreurs(self):
        with self.assertRaises(ErreurDensification):
            densifier(self.ANCIENS[:2])
        with self.assertRaises(ErreurDensification):
            densifier([_pt('A', 0, 0), _pt('B', 10, 10), _pt('C', 20, 20)])


class CatalogueFondsTests(SimpleTestCase):
    def test_catalogue_coherent(self):
        ids = [f['id'] for f in CATALOGUE]
        self.assertEqual(len(ids), len(set(ids)))
        cats = {c['code'] for c in CATEGORIES}
        for f in CATALOGUE:
            with self.subTest(fond=f['id']):
                self.assertIn(f['categorie'], cats)
                self.assertTrue(f['attribution'] and f['licence'])
                self.assertTrue(f['url'].startswith('https://'))
                self.assertNotIn('google', f['url'].lower())
                if f['type'] == 'xyz':
                    self.assertTrue(all(k in f['url'] for k in ('{z}', '{x}', '{y}')))
                else:
                    self.assertTrue(f['couches'])
        self.assertTrue(set(FONDS_PAR_DEFAUT) <= set(ids))
        self.assertTrue(any(f['categorie'] == 'satellitaire' for f in CATALOGUE))


class ApiDensificationTests(ApiTests):
    """Nouveaux endpoints : mêmes données que ApiTests (+ une pièce RC)."""

    def setUp(self):
        super().setUp()
        Piece.objects.create(type_piece='RC', ssdgps=self.ssdgps, payload={'rows': _rc(
            {('B1', 'B2'): '0,05', ('B1', 'B3'): '0,04', ('B2', 'B3'): '0,30'})})

    def test_referentiel_fonds_et_tolerance(self):
        self.client.force_authenticate(self.agent)
        r = self.client.get(URL + 'referentiel/').data
        self.assertTrue(r['fonds']['catalogue'])
        self.assertTrue(r['fonds']['aide_personnalise'])
        self.assertEqual(r['defauts']['tolerance_rc_m'], 0.15)
        self.assertEqual(r['defauts']['rayon_couverture_km'], 5.0)

    def test_tolerance_de_l_operateur(self):
        self.agent.tolerances_config = {'rc_ecarts': {'max_m': 0.10}}
        self.agent.save()
        self.client.force_authenticate(self.agent)
        self.assertEqual(self.client.get(URL + 'referentiel/').data['defauts']['tolerance_rc_m'], 0.10)

    def test_analyser_ecarts(self):
        self.client.force_authenticate(self.admin_org)
        lignes = _rc({('A', 'B'): 0.05, ('A', 'C'): 0.05, ('B', 'C'): 0.5})
        resp = self.client.post(URL + 'analyser-ecarts/', {'lignes': lignes, 'tolerance_m': 0.15}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data['homogenes']), 2)
        resp = self.client.post(URL + 'analyser-ecarts/', {'lignes': lignes, 'tolerance_m': 0}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(URL + 'analyser-ecarts/', {'lignes': [{'x': 1}]}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_sources_rc_filtrees(self):
        self.client.force_authenticate(self.agent)
        self.assertEqual(len(self.client.get(URL + 'sources-rc/').data), 1)
        self.assertEqual(len(self.client.get(f'{URL}sources-rc/{self.ssdgps.id}/').data['lignes']), 6)
        self.client.force_authenticate(self.intrus)
        self.assertEqual(self.client.get(URL + 'sources-rc/').data, [])
        self.assertEqual(self.client.get(f'{URL}sources-rc/{self.ssdgps.id}/').status_code, 404)

    def test_densifier_tous_roles(self):
        anciens = [_pt('A', 420000, 380000), _pt('B', 430000, 380000), _pt('C', 425000, 388000)]
        for user in (self.agent, self.admin_org, self.sys, self.root):
            with self.subTest(user=user.email):
                self.client.force_authenticate(user)
                resp = self.client.post(URL + 'densifier/', {'anciens': anciens, 'nb_nouveaux': 1},
                                        format='json')
                self.assertEqual(resp.status_code, 200, resp.data)
                self.assertEqual(len(resp.data['proposes']), 1)
        resp = self.client.post(URL + 'densifier/', {'anciens': anciens[:2]}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(URL + 'densifier/', {'anciens': anciens}, format='json').status_code, 401)
