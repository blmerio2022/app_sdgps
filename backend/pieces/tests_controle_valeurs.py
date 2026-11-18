"""
Contrôle des VALEURS des pièces (`controle_valeurs.py`), intégré au contrôle croisé.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Organization
from pieces.controle_croise import analyser_controle_croise
from pieces.models import Piece
from pieces.rc import compute_rapport_controle, determinations_from_rdia
from pieces.tolerances import ToleranceInvalide, normaliser
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()

LPA = [{'nom_point': 'A', 'x_m': '1000.00', 'y_m': '1000.00'},
       {'nom_point': 'B', 'x_m': '2000.00', 'y_m': '1000.00'},
       {'nom_point': 'C', 'x_m': '1500.00', 'y_m': '2000.00'}]


def det(numero, fixe, x_fixe=None, sigma='0.010', autres=('B', 'C'), decal=0.0):
    """Bloc RDIA : `fixe` tenu fixe, les autres calculés (décalés de `decal` m en X)."""
    coords = {r['nom_point']: r for r in LPA}
    rows = [{'determination': numero, 'nom_point': fixe, 'x_m': x_fixe or coords[fixe]['x_m'], 'y_m': coords[fixe]['y_m'],
             'sigma_x_m': 'FIXE', 'sigma_y_m': 'FIXE'}]
    for n in autres:
        rows.append({'determination': numero, 'nom_point': n,
                     'x_m': f"{float(coords[n]['x_m']) + decal:.2f}", 'y_m': coords[n]['y_m'],
                     'sigma_x_m': sigma, 'sigma_y_m': sigma})
    return rows


class ControleValeursTests(TestCase):
    def setUp(self):
        org = Organization.objects.create(code='ORG-V', name='Org V')
        projet = Projet.objects.create(nom_projet='P', code_projet='PV', organization=org)
        prop = Propriete.objects.create(nom_propriete='X', id_requisition='R1/1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=prop)
        self.ss = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1, type_ssdgps='mono-session',
                                        affaire=aff)
        self.piece('LPA', LPA)

    def piece(self, type_piece, rows, numero=None):
        return Piece.objects.create(ssdgps=self.ss, type_piece=type_piece, numero=numero, payload={'rows': rows})

    def codes(self, config=None):
        r = analyser_controle_croise(Piece.objects.filter(ssdgps=self.ss, is_deleted=False), config)
        return {c['code']: c for c in r['controles']}

    # 1. Points fixes
    def test_point_fixe_decale_de_la_lpa(self):
        self.piece('RDIA', det('N°1', 'A', x_fixe='1000.05') + det('N°2', 'B', autres=('A', 'C')))
        c = self.codes()
        self.assertEqual(c['fixe_coord_rdia']['points'], ['RDIA N°1 : A (Δ 5,0 cm)'])
        self.assertEqual(c['fixe_coord_rdia']['gravite'], 'erreur')

    def test_point_fixe_hors_lpa_et_point_fixe_en_libre(self):
        rows = det('N°1', 'A')
        rows[0]['nom_point'] = 'Z'
        self.piece('RDIA', rows)
        self.piece('RDL', [{'nom_point': 'A', 'x_m': '1000', 'y_m': '1000', 'sigma_x_m': 'FIXE', 'sigma_y_m': 'FIXE'}])
        c = self.codes()
        self.assertEqual(c['fixe_hors_lpa_rdia']['points'], ['RDIA N°1 : Z'])
        self.assertIn('fixe_rdl', c)

    def test_determination_sans_point_fixe(self):
        self.piece('RDN', [{'nom_point': 'A', 'x_m': '1000', 'y_m': '1000', 'sigma_x_m': '0.01', 'sigma_y_m': '0.01'}],
                   numero=2)
        self.assertEqual(self.codes()['sans_fixe_rdn']['points'], ['Détermination N°2'])

    def test_sigmas_eleves_et_seuil_reglable(self):
        self.piece('RDIA', det('N°1', 'A', sigma='0.080'))
        self.assertEqual(self.codes()['sigma_rdia']['nombre'], 2)
        self.assertNotIn('sigma_rdia', self.codes({'cc_sigmas': {'sigma_max_m': 0.10}}))
        self.assertNotIn('sigma_rdia', self.codes({'cc_sigmas': {'actif': False}}))

    # 2. RC périmé, RC ↔ RDD
    def test_rc_a_jour_puis_perime(self):
        rdia_rows = det('N°1', 'A') + det('N°2', 'B', autres=('A', 'C'))
        self.piece('RDIA', rdia_rows)
        rc = self.piece('RC', compute_rapport_controle(LPA, determinations_from_rdia(rdia_rows)))
        self.assertNotIn('rc_perime', self.codes())
        lignes = rc.payload['rows']
        lignes[1]['delta_d_m'] = '0.99'
        Piece.objects.filter(pk=rc.pk).update(payload={'rows': lignes})
        self.assertIn('rc_perime', self.codes())

    def test_rdd_tenu_fixe_sur_un_point_non_homogene(self):
        # C est décalé de 50 cm dans les deux déterminations : hors du groupe homogène.
        rdia_rows = det('N°1', 'A', decal=0.0, autres=('B',)) + det('N°2', 'B', autres=('A',))
        rdia_rows += [{'determination': 'N°1', 'nom_point': 'C', 'x_m': '1500.50', 'y_m': '2000.00',
                       'sigma_x_m': '0.01', 'sigma_y_m': '0.01'},
                      {'determination': 'N°2', 'nom_point': 'C', 'x_m': '1500.50', 'y_m': '2000.00',
                       'sigma_x_m': '0.01', 'sigma_y_m': '0.01'}]
        self.piece('RDIA', rdia_rows)
        self.piece('RC', compute_rapport_controle(LPA, determinations_from_rdia(rdia_rows)))
        self.piece('RDD', [{'nom_point': 'C', 'x_m': '1500.00', 'y_m': '2000.00', 'sigma_x_m': 'FIXE', 'sigma_y_m': 'FIXE'}])
        self.assertEqual(self.codes()['rdd_fixe_non_homogene']['points'], ['C'])

    # 3. Vecteurs
    def test_vecteurs(self):
        self.piece('ROB', [
            {'point': 'A', 'heure_debut': '20/05/2017 08:00:00', 'heure_fin': '20/05/2017 10:00:00', 'duree': '02:00:00'},
            {'point': 'B', 'heure_debut': '20/05/2017 09:30:00', 'heure_fin': '20/05/2017 11:00:00', 'duree': '01:30:00'},
            {'point': 'C', 'heure_debut': '20/05/2017 08:00:00', 'heure_fin': '20/05/2017 11:00:00', 'duree': '03:00:00'},
        ])
        self.piece('RTLB', [
            {'id_vec': 'V1', 'de': 'A', 'vers': 'B', 'solution': 'Flottante', 'duree': '01:00:00',
             'longueur_m': '20 000', 'prec_horiz_m': '0.09', 'prec_vert_m': '0.02', 'rms_m': '0.01'},
            {'id_vec': 'V2', 'de': 'A', 'vers': 'C', 'solution': 'Fixe', 'duree': '01:30:00', 'longueur_m': '1000'},
            {'id_vec': 'V3', 'de': 'B', 'vers': 'C', 'solution': 'Fixe', 'duree': '01:00:00', 'longueur_m': '1000'},
        ])
        c = self.codes()
        self.assertEqual(c['vecteur_non_fixe']['points'], ['V1 (A → B)'])
        self.assertEqual(c['vecteur_prec_horiz_m']['points'], ['V1 (A → B) : 9,0 cm'])
        self.assertIn('V1 (A → B) : 20,00 km', c['vecteur_longueur']['points'])
        # A et B ne se recouvrent que 30 min pour un vecteur d'une heure.
        self.assertEqual(len(c['vecteur_simultaneite']['points']), 1)
        self.assertIn('V1 (A → B)', c['vecteur_simultaneite']['points'][0])
        self.assertNotIn('station_une_liaison', c)

    # 4. Boucles
    def test_vecteur_hors_boucle_et_ppm(self):
        self.piece('RTLB', [{'id_vec': 'V1', 'de': 'A', 'vers': 'B', 'solution': 'Fixe'},
                            {'id_vec': 'V2', 'de': 'B', 'vers': 'C', 'solution': 'Fixe'},
                            {'id_vec': 'V3', 'de': 'C', 'vers': 'A', 'solution': 'Fixe'},
                            {'id_vec': 'V4', 'de': 'A', 'vers': 'C', 'solution': 'Fixe'}])
        self.piece('RFB', [{'id_boucle': 'V1-V2-V3', 'nom_boucle': 'A-B-C', 'ppm': '35'},
                           {'id_boucle': 'V1-V9', 'nom_boucle': 'A-B', 'ppm': '2'}])
        c = self.codes()
        self.assertEqual(c['vecteur_hors_boucle']['points'], ['V4 (A → C)'])
        self.assertEqual(c['boucle_vecteur_inconnu']['points'], ['V9 (boucle A-B)'])
        self.assertEqual(c['boucle_ppm']['points'], ['A-B-C : 35 ppm'])

    # 5. Observations
    def test_observations(self):
        self.piece('ROB', [
            {'point': 'A', 'heure_debut': '20/05/2017 10:00:00', 'heure_fin': '20/05/2017 09:00:00', 'fichier': 'F1.T02'},
            {'point': 'B', 'heure_debut': '20/05/2017 08:00:00', 'heure_fin': '20/05/2017 09:00:00', 'duree': '02:00:00',
             'fichier': 'F1.T02', 'haut_ant_m': '4.5'},
            {'point': 'C', 'heure_debut': '20/05/2017 08:00:00', 'heure_fin': '20/05/2017 09:00:00', 'duree': '01:00:00',
             'cadence': '00:00:05', 'epoques': '300', 'haut_ant_m': '1.2'},
        ])
        c = self.codes()
        self.assertIn('obs_fin_avant_debut', c)
        self.assertEqual(c['obs_fichier_partage']['points'], ['F1.T02 : A, B'])
        self.assertEqual(len(c['obs_duree']['points']), 1)
        self.assertEqual(c['obs_completude']['points'], ['C (sans fichier) : 42 %'])
        self.assertEqual(c['obs_hauteur']['points'], ['B (F1.T02) : 4,500 m'])

    def test_dossier_sain_aucune_anomalie_de_valeur(self):
        rdia_rows = det('N°1', 'A') + det('N°2', 'B', autres=('A', 'C')) + det('N°3', 'C', autres=('A', 'B'))
        self.piece('RDIA', rdia_rows)
        self.piece('RC', compute_rapport_controle(LPA, determinations_from_rdia(rdia_rows)))
        self.piece('RDD', [dict(r, sigma_x_m='FIXE', sigma_y_m='FIXE') for r in LPA])
        codes = set(self.codes())
        self.assertFalse({c for c in codes if c.startswith(('fixe', 'rc_', 'rdd_', 'sigma', 'n12'))}, codes)


class ToleranceParametresTests(TestCase):
    def test_normalisation_des_nouveaux_seuils(self):
        propre = normaliser({'cc_vecteurs': {'longueur_max_km': '10', 'marge_simultaneite_s': 30.4,
                                             'prec_h_max_m': 0.02},
                             'cc_boucles': {'max_ppm': 12}, 'cc_observations': {'completude_min_pct': 90}})
        self.assertEqual(propre['cc_vecteurs'], {'longueur_max_km': 10.0, 'marge_simultaneite_s': 30, 'prec_h_max_m': 0.02})
        self.assertEqual(propre['cc_boucles'], {'max_ppm': 12.0})
        with self.assertRaises(ToleranceInvalide):
            normaliser({'cc_observations': {'completude_min_pct': 150}})
