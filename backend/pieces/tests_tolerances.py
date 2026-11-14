"""
Tolérances de l'opérateur et signalement des valeurs hors tolérance dans le rapport.

Verrouille :
- la lecture des durées et des nombres dans les formats rencontrés dans les rapports GNSS ;
- la reconnaissance du mode d'observation (statique / stop and go) ;
- chaque règle, valeurs par défaut comprises (30 min en statique ; 40 s en stop and go,
  40 s pile ACCEPTÉE pour les observations brutes mais REFUSÉE pour les vecteurs ;
  ΔD ≤ 15 cm ; boucle tolérable) ;
- l'API `me/tolerances/` (lecture, validation, réinitialisation, isolation par compte) ;
- le marquage des cellules et la légende dans le contexte et le HTML du rapport.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.template.loader import render_to_string
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces import tolerances as T
from pieces.models import Piece
from pieces.report import build_report_context, flat_blocks, _group_versions
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()
URL = '/api/auth/me/tolerances/'


class LectureTests(SimpleTestCase):
    def test_durees(self):
        cas = {
            '00:45:12': 2712, '45:12': 2712, '00:00:40.0': 40, '1h02m03s': 3723,
            '1 h 30 min': 5400, '45 min': 2700, '40 s': 40, '40': 40, '40,5 s': 40.5,
            "30'": 1800, 2700: 2700,
        }
        for valeur, attendu in cas.items():
            self.assertEqual(T.duree_secondes(valeur), attendu, valeur)

    def test_durees_illisibles(self):
        for valeur in (None, '', '--', 'abc', '12 lunes', '1 2'):
            self.assertIsNone(T.duree_secondes(valeur), valeur)

    def test_nombres(self):
        self.assertEqual(T.nombre('0.023'), 0.023)
        self.assertEqual(T.nombre('-0,012'), -0.012)
        self.assertEqual(T.nombre('353 108.16'), 353108.16)
        self.assertIsNone(T.nombre('--'))

    def test_modes(self):
        modes = T.DEFAUTS['modes']
        self.assertEqual(T.mode_observation('Statique', modes), 'statique')
        self.assertEqual(T.mode_observation('STATIC', modes), 'statique')
        self.assertEqual(T.mode_observation('Stop & Go', modes), 'stopgo')
        self.assertEqual(T.mode_observation('Stop and go', modes), 'stopgo')
        # Libellés réels des logiciels Trimble en français.
        self.assertEqual(T.mode_observation('Arrêt et marche', modes), 'stopgo')
        self.assertEqual(T.mode_observation('Statique ou FastStatic', modes), 'statique')
        self.assertIsNone(T.mode_observation('Cinématique', modes))
        self.assertIsNone(T.mode_observation('', modes))


class ReglesTests(SimpleTestCase):
    def test_rob_durees_par_defaut(self):
        rows = [
            {'type': 'Statique', 'duree': '00:29:59'},   # hors (< 30 min)
            {'type': 'Statique', 'duree': '00:30:00'},   # limite acceptée
            {'type': 'Stop & Go', 'duree': '00:00:39'},  # hors
            {'type': 'Stop & Go', 'duree': '00:00:40'},  # limite acceptée (observations)
            {'type': 'Inconnu', 'duree': '00:00:01'},    # mode inconnu : non contrôlé
            {'type': 'Statique', 'duree': '--'},          # durée illisible : non contrôlée
        ]
        flags, alerte = T.evaluer('ROB', 'brut', rows, None)
        self.assertEqual(flags, [{'duree'}, set(), {'duree'}, set(), set(), set()])
        self.assertIn('2 observation(s)', alerte)
        self.assertIn('30 min', alerte)

    def test_rtlb_40_s_pile_hors_tolerance(self):
        rows = [{'methode_terrain': 'Stop and Go', 'duree': '40 s'},
                {'methode_terrain': 'Stop and Go', 'duree': '41 s'},
                {'methode_terrain': 'Statique', 'duree': '1:00:00'}]
        flags, alerte = T.evaluer('RTLB', 'brut', rows, None)
        self.assertEqual(flags, [{'duree'}, set(), set()])
        self.assertIn('> 40 s', alerte)

    def test_rfb_non_tolerable(self):
        rows = [{'delta_3d_m': '0.020', 'tolerance_m': '0.050', 'tolerable': 'Oui'},
                {'delta_3d_m': '0.080', 'tolerance_m': '0.050', 'tolerable': 'Oui'},
                {'delta_3d_m': '0.010', 'tolerance_m': '0.050', 'tolerable': 'Non'}]
        flags, alerte = T.evaluer('RFB', 'brut', rows, None)
        self.assertEqual(flags, [set(), {'delta_3d_m', 'tolerable'}, {'delta_3d_m', 'tolerable'}])
        self.assertIn('2 boucle(s)', alerte)

    def test_ecarts_determinations_15_cm(self):
        rows = [{'delta_d_m': '0.150'}, {'delta_d_m': '0.151'}, {'delta_d_m': '--'},
                {'delta_d_m': '-0.30'}]
        for type_piece in ('RDL', 'RDN', 'RDIA'):
            flags, alerte = T.evaluer(type_piece, 'ecarts', rows, None)
            self.assertEqual(flags, [set(), {'delta_d_m'}, set(), {'delta_d_m'}], type_piece)
            self.assertIn('15 cm', alerte)
        # La version brute d'une RDL ne porte pas d'écarts : aucune règle.
        self.assertEqual(T.evaluer('RDL', 'brut', rows, None), (None, ''))
        # RDI (DLC) : les écarts sont dans la version brute.
        self.assertEqual(T.evaluer('RDI', 'brut', rows, None)[0][1], {'delta_d_m'})

    def test_rc(self):
        flags, alerte = T.evaluer('RC', 'brut', [{'delta_d_m': '0.2'}], {'rc_ecarts': {'max_m': 0.25}})
        self.assertEqual(flags, [set()])
        self.assertEqual(alerte, '')

    def test_regle_desactivee(self):
        cfg = {'rob_duree': {'actif': False}}
        self.assertEqual(T.evaluer('ROB', 'brut', [{'type': 'Statique', 'duree': '1'}], cfg), (None, ''))

    def test_seuils_et_mots_cles_de_l_operateur(self):
        cfg = {'rob_duree': {'statique_min_s': 3600},
               'modes': {'statique': ['fixe'], 'stopgo': ['sg']}}
        rows = [{'type': 'Fixe', 'duree': '00:45:00'}, {'type': 'Statique', 'duree': '00:01:00'}]
        flags, _ = T.evaluer('ROB', 'brut', rows, cfg)
        # « Statique » n'est plus reconnu : seuls les mots-clés de l'opérateur comptent.
        self.assertEqual(flags, [{'duree'}, set()])

    def test_autres_types_sans_regle(self):
        self.assertEqual(T.evaluer('LPA', 'brut', [{'x': 1}], None), (None, ''))


class NormalisationTests(SimpleTestCase):
    def test_garde_les_cles_connues(self):
        propre = T.normaliser({'rob_duree': {'statique_min_s': '1200', 'bidon': 1},
                               'inconnue': {}, 'rc_ecarts': {'max_m': 0.1, 'actif': False}})
        self.assertEqual(propre, {'rob_duree': {'statique_min_s': 1200},
                                  'rc_ecarts': {'max_m': 0.1, 'actif': False}})

    def test_valeurs_invalides(self):
        for cfg in ({'rob_duree': {'statique_min_s': -1}}, {'rc_ecarts': {'max_m': 'x'}},
                    {'rc_ecarts': {'actif': 'oui'}}, {'modes': {'statique': []}},
                    {'modes': {'stopgo': 'stop'}}, {'rob_duree': 3}, []):
            with self.assertRaises(T.ToleranceInvalide, msg=cfg):
                T.normaliser(cfg)

    def test_effectives_completent_les_defauts(self):
        eff = T.effectives({'rc_ecarts': {'max_m': 0.1}})
        self.assertEqual(eff['rc_ecarts'], {'actif': True, 'max_m': 0.1})
        self.assertEqual(eff['rob_duree'], T.DEFAUTS['rob_duree'])


class ApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='t@sdgps.ma', email='t@sdgps.ma',
                                             password='Passw0rd!')
        self.autre = User.objects.create_user(username='u@sdgps.ma', email='u@sdgps.ma',
                                              password='Passw0rd!')
        self.client.force_authenticate(self.user)

    def test_lecture_par_defaut(self):
        data = self.client.get(URL).data
        self.assertEqual(data['config'], {})
        self.assertEqual(data['effectives']['ecarts_determinations']['max_m'], 0.15)
        self.assertIn('rob_duree', data['libelles'])

    def test_enregistrement_puis_reinitialisation(self):
        resp = self.client.put(URL, {'rc_ecarts': {'max_m': 0.1}}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['effectives']['rc_ecarts']['max_m'], 0.1)
        self.user.refresh_from_db()
        self.assertEqual(self.user.tolerances_config, {'rc_ecarts': {'max_m': 0.1}})
        # Chaque opérateur a SES tolérances.
        self.client.force_authenticate(self.autre)
        self.assertEqual(self.client.get(URL).data['effectives']['rc_ecarts']['max_m'], 0.15)
        self.client.force_authenticate(self.user)
        resp = self.client.post(f'{URL}reset/')
        self.assertEqual(resp.data['config'], {})

    def test_valeur_invalide_400(self):
        resp = self.client.put(URL, {'rob_duree': {'stopgo_min_s': 'vite'}}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('stopgo_min_s', resp.data['detail'])

    def test_non_authentifie(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)


class RapportTests(TestCase):
    """Marquage dans le contexte du rapport et dans le HTML rendu."""

    def setUp(self):
        org = Organization.objects.create(code='ORG-T', name='Org T')
        user = User.objects.create_user(username='r@sdgps.ma', email='r@sdgps.ma', password='x')
        Membership.objects.create(user=user, organization=org, role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-T', organization=org)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T1/A', projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2024, 1, 1, tzinfo=dt_timezone.utc), propriete=propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            affaire=affaire)
        self.piece = Piece.objects.create(
            ssdgps=self.ssdgps, type_piece='ROB', statut='valide', source_saisie='manuel',
            payload={'rows': [
                {'id': 1, 'point': 'B1', 'type': 'Statique', 'duree': '00:20:00'},
                {'id': 2, 'point': 'B2', 'type': 'Statique', 'duree': '00:45:00'},
            ]})

    def _contexte(self, tolerances=None):
        ctx = build_report_context(self.ssdgps, None, [self.piece], tolerances=tolerances)
        return ctx, ctx['pieces'][0]['content']['tables'][0]

    def test_cellule_et_ligne_marquees(self):
        _, table = self._contexte()
        ligne1, ligne2 = table['flat']
        duree1 = next(c for c in ligne1 if c['name'] == 'duree')
        self.assertTrue(duree1.get('hors_tol'))
        self.assertTrue(all(c.get('row_hors_tol') for c in ligne1))
        self.assertFalse(any(c.get('hors_tol') or c.get('row_hors_tol') for c in ligne2))
        self.assertIn('1 observation(s)', table['alerte'])

    def test_tolerances_de_l_operateur_appliquees(self):
        _, table = self._contexte({'rob_duree': {'statique_min_s': 600}})
        self.assertEqual(table['alerte'], '')
        self.assertFalse(any(c.get('hors_tol') for row in table['flat'] for c in row))

    def test_html_signale_la_valeur(self):
        ctx, _ = self._contexte()
        piece = ctx['pieces'][0]
        blocks = flat_blocks(piece['content']['tables'])
        html = render_to_string('pieces/report.html', {
            'header': ctx['header'], 'mode': 'piece', 'foot_prefix': '', 'duplex': False,
            'piece': {**piece, 'content': {**piece['content'], 'blocks': blocks,
                                           'versions': _group_versions(blocks)}}})
        self.assertIn('class="tol-alerte"', html)
        self.assertEqual(html.count(' hors-tol"'), 1)
        self.assertIn('row-hors-tol', html)

    def test_generation_utilise_les_tolerances_du_demandeur(self):
        """La génération synchrone transmet les tolérances du compte appelant."""
        from unittest import mock
        user = User.objects.get(email='r@sdgps.ma')
        user.tolerances_config = {'rob_duree': {'actif': False}}
        user.save()
        client = APIClient()
        client.force_authenticate(user)
        with mock.patch('pieces.views.render_report_pdf', return_value=b'%PDF') as rendu:
            client.get('/api/v1/pieces/report/', {'ssdgps': str(self.ssdgps.pk)})
        self.assertEqual(rendu.call_args.kwargs['tolerances'], {'rob_duree': {'actif': False}})
