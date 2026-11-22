"""
Classeur Excel à plusieurs feuilles (une pièce par feuille) — import en masse ET import
unitaire — et en-têtes des exports réels (synonymes).

Fixture reprenant la structure des classeurs « AUTRES-PIECES.xlsx » des études Zelmath :
feuilles « Feuil1…Feuil4 » (aucun indice dans le nom), en-têtes TBC (« ID du point »,
« Abscisse », « Heure de démarrage », « De l'ID de point »…), dates et heures Excel.
"""
import datetime as dt
import io
import json

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from pieces.import_masse import ALIAS, choisir_feuille, correspondance
from pieces.models import Piece
from pieces.parsing import _cellule
from projects.tests_workflow_ssdgps import WorkflowBaseTest

FEUILLES = {
    'Feuil1': (['ID du point', 'Abscisse', 'Ordonnée', 'Reference fonciere', 'Materialisation', 'Signalisation'],
               [['AXIGEO20', 271297.52, 181655.69, 'Répertoire', 'Borne GPS', 'AUCUNE'],
                ['L91', 269273.3, 175209.23, 'Répertoire', 'Monopode', 'Monopode']]),
    'Feuil2': (['ID du point', 'Abscisse', 'Ordonnée', 'Date Visite', 'Systeme'],
               [['AXIGEO20', 271297.52, 181655.69, dt.datetime(2024, 7, 11), 'Lambert  Zone I'],
                ['L91', 269273.3, 175209.23, dt.datetime(2024, 7, 12), 'Lambert  Zone I']]),
    'Feuil3': (['ID du point', 'Heure de démarrage', 'Heure de fin', 'Durée', 'Epoques', 'Méthode sur terrain ',
                'Nom du fichier', 'Hauteur ant.', 'Méthode ant.', 'Fabricant ant.', 'Type ant.'],
               [['AXIGEO20', dt.datetime(2024, 7, 11, 8, 3, 21), dt.datetime(2024, 7, 11, 11, 37, 52),
                 dt.time(3, 34, 32), 12872, 'Statique', 'AxiGeo193I.24O', 1.67, "Base du support d'antenne", 'CHC', 'i50']]),
    'Feuil4': (['ID de vecteur', "De l'ID de point", "A l'ID de point", 'Type de solution', 'Satellites', 'Epoques',
                'Longueur du vecteur', 'Méthode sur terrain ', 'Heure de démarrage', 'Heure de fin', 'Durée'],
               [['PV284', 'AXIGEO20', 'L91', 'Fixe', 11, 187, 6758.62, 'Statique ou FastStatic',
                 dt.datetime(2024, 7, 11, 10, 30, 2), dt.datetime(2024, 7, 11, 11, 1, 14), dt.time(0, 31, 12)]]),
}


def classeur_zelmath(nom='AUTRES-PIECES.xlsx'):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for titre, (entetes, lignes) in FEUILLES.items():
        ws = wb.create_sheet(titre)
        ws.append(entetes)
        for ligne in lignes:
            ws.append(ligne)
    buf = io.BytesIO()
    wb.save(buf)
    return SimpleUploadedFile(nom, buf.getvalue(),
                              content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


class CelluleTests(SimpleTestCase):
    def test_formats(self):
        self.assertEqual(_cellule(dt.datetime(2024, 7, 11, 8, 3, 21)), '11/07/2024 08:03:21')
        self.assertEqual(_cellule(dt.datetime(2024, 7, 11)), '11/07/2024')
        self.assertEqual(_cellule(dt.date(2024, 7, 11)), '11/07/2024')
        self.assertEqual(_cellule(dt.time(3, 34, 32)), '03:34:32')
        self.assertEqual(_cellule(dt.timedelta(hours=27, seconds=5)), '27:00:05')
        self.assertEqual(_cellule(12872.0), '12872')
        self.assertEqual(_cellule(1.67), '1.67')
        self.assertEqual(_cellule(None), '')


class SynonymesTests(SimpleTestCase):
    def test_entetes_des_exports_reels(self):
        champs = [{'name': n, 'label': n} for n in ('point', 'heure_debut', 'haut_ant_m', 'antenne', 'ref_antenne')]
        m = correspondance(FEUILLES['Feuil3'][0], champs)
        self.assertEqual(m, {'point': 'ID du point', 'heure_debut': 'Heure de démarrage', 'haut_ant_m': 'Hauteur ant.',
                             'antenne': 'Type ant.', 'ref_antenne': 'Méthode ant.'})
        self.assertIn("De l'ID de point", ALIAS['de'])


class ClasseurImportMasseTests(WorkflowBaseTest):
    def test_chaque_feuille_reconnue_par_ses_en_tetes(self):
        r = self.client.post('/api/v1/pieces/import-plan/', {
            'ssdgps': str(self.ssdgps.id), 'fichiers': [classeur_zelmath()],
            'chemins': json.dumps(['AUTRES-PIECES.xlsx'])}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        types = {l['feuille']: l['type_piece'] for l in r.data['plan']}
        self.assertEqual(types, {'Feuil1': 'LPA', 'Feuil2': 'PPA', 'Feuil3': 'ROB', 'Feuil4': 'RTLB'})
        rob = next(l for l in r.data['plan'] if l['feuille'] == 'Feuil3')
        self.assertEqual(rob['mapping']['haut_ant_m'], 'Hauteur ant.')
        self.assertEqual(rob['apercu'][0][1], '11/07/2024 08:03:21')          # date Excel lisible


class ClasseurImportUnitaireTests(WorkflowBaseTest):
    URL = '/api/v1/pieces/import/'

    def test_feuille_choisie_d_apres_le_type_et_correspondance_proposee(self):
        r = self.client.post(self.URL, {'fichier': classeur_zelmath(), 'type_piece': 'RTLB'}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['feuille'], 'Feuil4')
        self.assertEqual([f['nom'] for f in r.data['feuilles']], ['Feuil1', 'Feuil2', 'Feuil3', 'Feuil4'])
        suggeres = {f['nom']: f['type_suggere'] for f in r.data['feuilles']}
        self.assertEqual(suggeres['Feuil1'], 'LPA')
        self.assertEqual(suggeres['Feuil3'], 'ROB')
        self.assertEqual(r.data['mapping_propose']['de'], "De l'ID de point")
        self.assertEqual(r.data['mapping_propose']['longueur_m'], 'Longueur du vecteur')

    def test_feuille_imposee_puis_import(self):
        r = self.client.post(self.URL, {'fichier': classeur_zelmath(), 'type_piece': 'ROB', 'feuille': 'Feuil3'},
                             format='multipart')
        self.assertEqual(r.data['feuilles'], [])                     # feuille imposée : pas de choix à refaire
        mapping = r.data['mapping_propose']
        r = self.client.post(self.URL, {
            'fichier': classeur_zelmath(), 'type_piece': 'ROB', 'feuille': 'Feuil3', 'mapping': json.dumps(mapping),
            'ssdgps': str(self.ssdgps.id), 'session': str(self.ssdgps.sessions.first().id)}, format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        ligne = Piece.objects.get(type_piece='ROB').payload['rows'][0]
        self.assertEqual((ligne['point'], ligne['duree'], ligne['heure_debut']),
                         ('AXIGEO20', '03:34:32', '11/07/2024 08:03:21'))

    def test_classeur_d_une_seule_feuille_ou_csv_inchange(self):
        f, infos = choisir_feuille(SimpleUploadedFile('a.csv', b'Nom Point\nA\n'), 'LPA')
        self.assertEqual((f, infos), (None, []))
