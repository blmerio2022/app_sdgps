"""
Remarques de validation par pièce (`/api/v1/ssdgps/<id>/remarques/`).
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from notifications.models import Notification
from pieces.models import Piece, RemarqueValidation
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()


class RemarquesTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-RV', name='Org RV')
        self.redacteur = self._u('red@rv.ma', 'ROLE_ORGANISATION_AGENT')
        self.chef = self._u('chef@rv.ma', 'ROLE_ORGANISATION_ADMIN')
        projet = Projet.objects.create(nom_projet='P', code_projet='RV-1', organization=self.org,
                                       created_by=self.redacteur)
        prop = Propriete.objects.create(nom_propriete='X', id_requisition='R1/1', projet=projet)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=prop)
        self.ss = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1, type_ssdgps='mono-session',
                                        affaire=aff, created_by=self.redacteur)
        self.rdia = Piece.objects.create(ssdgps=self.ss, type_piece='RDIA', statut='valide', payload={'rows': []})
        self.url = f'/api/v1/ssdgps/{self.ss.pk}/remarques/'
        self.client = APIClient()

    def _u(self, email, role):
        u = User.objects.create_user(username=email, email=email, password='Passw0rd!')
        Membership.objects.create(user=u, organization=self.org, role=role)
        return u

    def _comme(self, user):
        self.client.force_authenticate(user)

    def _remarque(self, **extra):
        self._comme(self.chef)
        resp = self.client.post(self.url, {'texte': 'σ incohérent sur BT11', 'piece': str(self.rdia.pk),
                                           'ligne': 'BT11', **extra}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.data['remarques'][-1]

    def test_encadrement_annote_une_piece_et_une_ligne(self):
        r = self._remarque()
        self.assertEqual((r['piece'], r['ligne'], r['statut']), (str(self.rdia.pk), 'BT11', 'ouverte'))
        self.assertEqual(r['piece_libelle'], 'Rapport des déterminations intermédiaires')
        data = self.client.get(self.url).data
        self.assertEqual(data['ouvertes'], 1)
        self.assertTrue(data['peut_remarquer'])

    def test_un_agent_ne_remarque_pas(self):
        self._comme(self.redacteur)
        resp = self.client.post(self.url, {'texte': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(self.client.get(self.url).data['peut_remarquer'])

    def test_cycle_corriger_lever_rouvrir(self):
        r = self._remarque()
        base = f"{self.url}{r['id']}/"
        self._comme(self.redacteur)
        resp = self.client.post(f'{base}corriger/', {'reponse': 'σ recalculé'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        r2 = resp.data['remarques'][0]
        self.assertEqual((r2['statut'], r2['reponse'], r2['corrigee_par']), ('corrigee', 'σ recalculé', 'red@rv.ma'))
        self.assertEqual(self.client.post(f'{base}lever/').status_code, 403)       # pas l'encadrement
        self._comme(self.chef)
        self.assertEqual(self.client.post(f'{base}lever/').data['levees'], 1)
        self.assertEqual(self.client.post(f'{base}rouvrir/').data['ouvertes'], 1)

    def test_correction_refusee_sur_dossier_fige(self):
        r = self._remarque()
        Ssdgps.objects.filter(pk=self.ss.pk).update(statut='soumis')
        self._comme(self.redacteur)
        resp = self.client.post(f"{self.url}{r['id']}/corriger/", {}, format='json')
        self.assertEqual(resp.status_code, 409)
        # … mais l'encadrement remarque pendant l'examen d'un dossier soumis.
        self._comme(self.chef)
        self.assertEqual(self.client.post(self.url, {'texte': 'Autre'}, format='json').status_code, 201)

    def test_dossier_valide_plus_de_remarque(self):
        Ssdgps.objects.filter(pk=self.ss.pk).update(statut='valide')
        self._comme(self.chef)
        self.assertEqual(self.client.post(self.url, {'texte': 'x'}, format='json').status_code, 409)

    def test_validation_texte_et_piece(self):
        self._comme(self.chef)
        self.assertEqual(self.client.post(self.url, {'texte': '  '}, format='json').status_code, 400)
        autre = Piece.objects.create(ssdgps=Ssdgps.objects.create(
            nature_ssdgps='PDC/GPS', numero_ssdgps=2, type_ssdgps='mono-session', affaire=self.ss.affaire),
            type_piece='LPA')
        self.assertEqual(self.client.post(self.url, {'texte': 'x', 'piece': str(autre.pk)},
                                          format='json').status_code, 400)

    def test_suppression_par_l_auteur_seulement(self):
        r = self._remarque()
        self._comme(self.redacteur)
        self.assertEqual(self.client.delete(f"{self.url}{r['id']}/").status_code, 403)
        self._comme(self.chef)
        self.assertEqual(self.client.delete(f"{self.url}{r['id']}/").status_code, 200)
        self.assertFalse(RemarqueValidation.objects.exists())

    def test_remarque_survit_a_la_suppression_de_sa_piece(self):
        self._remarque()
        self.rdia.delete()
        r = RemarqueValidation.objects.get()
        self.assertIsNone(r.piece_id)
        self.assertEqual(r.piece_libelle, 'Rapport des déterminations intermédiaires')

    def test_rejet_notifie_le_nombre_de_remarques(self):
        self._remarque()
        Ssdgps.objects.filter(pk=self.ss.pk).update(statut='soumis')
        resp = self.client.post(f'/api/v1/ssdgps/{self.ss.pk}/transition/',
                                {'action': 'rejeter', 'motif': 'Voir les remarques'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        n = Notification.objects.get(destinataire=self.redacteur)
        self.assertIn('1 remarque à corriger', n.message)

    def test_rbac_hors_portee(self):
        autre = Organization.objects.create(code='ORG-Q', name='Q')
        intrus = User.objects.create_user(username='q@q.ma', email='q@q.ma', password='Passw0rd!')
        Membership.objects.create(user=intrus, organization=autre, role='ROLE_ORGANISATION_ADMIN')
        self._comme(intrus)
        self.assertEqual(self.client.get(self.url).status_code, 404)
