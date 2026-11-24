"""
Recalcul d'un rapport de contrôle EXISTANT (`POST /api/v1/pieces/<id>/recompute-rc/`).

Avant : pour tenir compte d'une LPA ou de déterminations corrigées, l'opérateur devait
supprimer la pièce RC puis la régénérer. Le recalcul remplace les lignes sur place,
archive l'ancien contenu (historique des versions) et respecte le verrou du dossier figé.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.models import Piece, PieceVersion
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()


def ligne(nom, x, y, fixe=False):
    s = 'FIXE' if fixe else '0.01'
    return {'nom_point': nom, 'x_m': x, 'y_m': y, 'sigma_x_m': s, 'sigma_y_m': s}


class RecalculRcTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-RC', name='Org RC')
        self.user = User.objects.create_user(username='rc@x.ma', email='rc@x.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org, role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='PRC', organization=self.org,
                                       created_by=self.user)
        prop = Propriete.objects.create(nom_propriete='X', id_requisition='R1/1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=prop)
        self.ss = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                        type_ssdgps='mono-session', affaire=aff)
        # LPA : la faute de saisie « AXl6 » a d'abord fait sortir A du RC.
        self.lpa = Piece.objects.create(ssdgps=self.ss, type_piece='LPA', payload={'rows': [
            {'nom_point': 'A', 'x_m': '100.00', 'y_m': '200.00'},
            {'nom_point': 'B', 'x_m': '150.00', 'y_m': '250.00'},
            {'nom_point': 'C', 'x_m': '300.00', 'y_m': '400.00'},
        ]})
        Piece.objects.create(ssdgps=self.ss, type_piece='RDIA', payload={'rows': [
            {'determination': 'N°1', **ligne('A', '100.00', '200.00', True)},
            {'determination': 'N°1', **ligne('B', '150.02', '250.00')},
            {'determination': 'N°1', **ligne('C', '300.00', '400.05')},
            {'determination': 'N°2', **ligne('A', '100.03', '200.00')},
            {'determination': 'N°2', **ligne('B', '150.00', '250.00', True)},
            {'determination': 'N°2', **ligne('C', '300.00', '400.00')},
        ]})
        self.rc = Piece.objects.create(ssdgps=self.ss, type_piece='RC', source_saisie='ui', payload={
            'rows': [{'id': '1', 'nom_point_fixe': 'B', 'nom_point_calcule': 'B'}],
            'sort': [{'field': 'id', 'dir': 'asc'}],
        })
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def url(self, piece=None):
        return f'/api/v1/pieces/{(piece or self.rc).id}/recompute-rc/'

    def test_recalcule_et_remplace_les_lignes_sur_place(self):
        rep = self.client.post(self.url(), {}, format='json')
        self.assertEqual(rep.status_code, 200, rep.data)
        self.rc.refresh_from_db()
        self.assertEqual(len(self.rc.payload['rows']), 6)              # 2 déterminations × 3 points
        self.assertEqual(self.rc.payload['source_rc'], 'rdia')
        self.assertEqual(self.rc.payload['sort'], [{'field': 'id', 'dir': 'asc'}])  # conservé
        self.assertEqual(rep.data['recalcul']['lignes_avant'], 1)
        self.assertEqual(rep.data['recalcul']['lignes_apres'], 6)
        self.assertTrue(rep.data['recalcul']['modifie'])
        self.assertEqual(Piece.objects.filter(ssdgps=self.ss, type_piece='RC').count(), 1)
        self.assertEqual(self.rc.updated_by, self.user)

    def test_l_ancien_contenu_est_archive(self):
        self.client.post(self.url(), {}, format='json')
        version = PieceVersion.objects.get(piece=self.rc)
        self.assertEqual(len(version.payload['rows']), 1)

    def test_recalcul_identique_signale_sans_modification(self):
        self.client.post(self.url(), {}, format='json')
        rep = self.client.post(self.url(), {}, format='json')
        self.assertFalse(rep.data['recalcul']['modifie'])
        self.assertEqual(PieceVersion.objects.filter(piece=self.rc).count(), 1)   # pas de 2ᵉ archive

    def test_tient_compte_d_une_lpa_corrigee(self):
        self.lpa.payload = {'rows': self.lpa.payload['rows'][:2]}      # C retiré de la LPA
        self.lpa.save()
        self.client.post(self.url(), {}, format='json')
        self.rc.refresh_from_db()
        self.assertNotIn('C', {r['nom_point_calcule'] for r in self.rc.payload['rows']})

    def test_refuse_sur_une_autre_piece_que_le_rc(self):
        rep = self.client.post(self.url(self.lpa), {}, format='json')
        self.assertEqual(rep.status_code, 400)

    def test_sources_manquantes(self):
        Piece.objects.filter(type_piece='RDIA').update(is_deleted=True)
        rep = self.client.post(self.url(), {}, format='json')
        self.assertEqual(rep.status_code, 400)
        self.assertIn('Sources manquantes', rep.data['detail'])

    def test_refuse_sur_un_dossier_fige(self):
        Ssdgps.objects.filter(pk=self.ss.pk).update(statut='soumis')
        rep = self.client.post(self.url(), {}, format='json')
        self.assertIn(rep.status_code, (400, 403, 409))
        self.rc.refresh_from_db()
        self.assertEqual(len(self.rc.payload['rows']), 1)

    def test_hors_portee_404(self):
        autre_org = Organization.objects.create(code='ORG-Z', name='Org Z')
        autre = User.objects.create_user(username='z@x.ma', email='z@x.ma', password='Passw0rd!')
        Membership.objects.create(user=autre, organization=autre_org, role='ROLE_ORGANISATION_ADMIN')
        self.client.force_authenticate(autre)
        rep = self.client.post(self.url(), {}, format='json')
        self.assertEqual(rep.status_code, 404)

    def test_la_generation_memorise_la_source(self):
        self.rc.delete()
        rep = self.client.post('/api/v1/pieces/compute-rc/',
                               {'ssdgps': str(self.ss.id), 'commit': '1'}, format='multipart')
        self.assertEqual(rep.status_code, 201, rep.data)
        self.assertEqual(rep.data['payload']['source_rc'], 'rdia')
