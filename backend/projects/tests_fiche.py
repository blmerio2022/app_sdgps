"""Fiche d'un élément au survol du fil d'Ariane — `GET /api/v1/fiche/<type>/<id>/`."""
import uuid

from accounts.models import Membership, Organization
from django.contrib.auth import get_user_model
from pieces.models import Piece, RemarqueValidation
from projects.models import Ssdgps
from projects.tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()


class FicheTests(WorkflowBaseTest):
    def url(self, type_, pk):
        return f'/api/v1/fiche/{type_}/{pk}/'

    def test_chaque_type_rend_une_fiche_mise_en_mots(self):
        a = self.ssdgps.affaire
        piece = self._piece('LPA')
        attendus = {
            'projet': (a.propriete.projet_id, 'Projet', 'P'),
            'propriete': (a.propriete_id, 'Propriété', 'T9400/A'),
            'affaire': (a.id, 'Affaire', 'SD 1'),
            'ssdgps': (self.ssdgps.id, 'SDGPS', 'SDGPS n°1'),
            'session': (self.session.id, 'Session', 'Session n°1'),
            'piece': (piece.id, 'Pièce', 'Liste des Points Anciens'),
        }
        for type_, (pk, libelle, titre) in attendus.items():
            r = self.client.get(self.url(type_, pk))
            self.assertEqual(r.status_code, 200, (type_, r.data))
            self.assertEqual((r.data['libelle_type'], r.data['titre']), (libelle, titre), type_)
            for cle in ('champs', 'compteurs', 'audit'):
                self.assertIn(cle, r.data)

    def test_contenu_du_sdgps_statut_compteurs_remarques(self):
        self._piece('LPA')
        self._piece('ROB', statut=Piece.Statut.BROUILLON, ordre=1)
        RemarqueValidation.objects.create(ssdgps=self.ssdgps, texte='À revoir', auteur=self.admin)
        r = self.client.get(self.url('ssdgps', self.ssdgps.id))
        self.assertEqual(r.data['statut_display'], 'En cours')
        compteurs = {c['label']: c['valeur'] for c in r.data['compteurs']}
        self.assertEqual(compteurs, {'Pièces': 2, 'Validées': 1, 'Remarques à corriger': 1})
        champs = {c['label']: c['valeur'] for c in r.data['champs']}
        self.assertEqual(champs['Type'], 'Mono-session')
        self.assertEqual(champs['Affaire'], 'SD 1 — BI')

    def test_audit_nom_complet_du_createur(self):
        self.agent.first_name, self.agent.last_name = 'Sara', 'Alaoui'
        self.agent.save()
        r = self.client.get(self.url('projet', self.ssdgps.affaire.propriete.projet_id))
        self.assertEqual(r.data['audit']['cree_par'], 'Sara Alaoui')
        self.assertEqual({c['label']: c['valeur'] for c in r.data['compteurs']}['SDGPS'], 1)

    def test_hors_portee_corbeille_type_inconnu_404(self):
        autre = User.objects.create_user(username='o@x.ma', email='o@x.ma', password='Passw0rd!')
        org = Organization.objects.create(code='ORG-AUTRE', name='Autre')
        Membership.objects.create(user=autre, organization=org, role='ROLE_ORGANISATION_ADMIN')
        self.client.force_authenticate(autre)
        self.assertEqual(self.client.get(self.url('ssdgps', self.ssdgps.id)).status_code, 404)
        self.client.force_authenticate(self.agent)
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(is_deleted=True)
        self.assertEqual(self.client.get(self.url('ssdgps', self.ssdgps.id)).status_code, 404)
        self.assertEqual(self.client.get(self.url('organisation', uuid.uuid4())).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url('projet', uuid.uuid4())).status_code, 401)
