"""
Cycle de vie d'un SDGPS : en cours → soumis → validé → clos.

Avant, rien ne distinguait un dossier en saisie d'un dossier contrôlé et arrêté : les
pièces d'un dossier « terminé » restaient modifiables par n'importe qui, et aucune trace
ne disait qui l'avait contrôlé ni quand.

Ce que ces tests verrouillent :
- les transitions légales, et seulement elles ;
- la règle de soumission : toutes les pièces vivantes doivent être validées ;
- le partage des rôles — un rédacteur soumet, l'encadrement valide, rejette, clôt ;
- le motif obligatoire au rejet et à la réouverture ;
- le VERROU : dès « soumis », plus aucune écriture sur les pièces du dossier ;
- la journalisation de chaque décision (qui, quoi, quand, pourquoi).
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps
from projects.workflow import est_encadrement, transitions_possibles

User = get_user_model()


class WorkflowBaseTest(TestCase):
    """Un SDGPS d'une organisation, avec un agent (rédacteur) et un admin org."""

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-WF', name='Org Workflow')
        self.agent = User.objects.create_user(username='ag@sdgps.ma', email='ag@sdgps.ma',
                                              password='Passw0rd!')
        Membership.objects.create(user=self.agent, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        self.admin = User.objects.create_user(username='ad@sdgps.ma', email='ad@sdgps.ma',
                                              password='Passw0rd!')
        Membership.objects.create(user=self.admin, organization=self.org,
                                  role='ROLE_ORGANISATION_ADMIN')

        projet = Projet.objects.create(nom_projet='P', code_projet='P-WF-1',
                                       organization=self.org, created_by=self.agent)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9400/A',
                                             projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc), propriete=propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='mono-session', affaire=affaire)
        # La session n°1 d'un SDGPS mono-session est créée automatiquement (structurelle).
        self.session = Session.objects.filter(ssdgps=self.ssdgps).first()
        self.client.force_authenticate(self.agent)

    def _piece(self, type_piece='LPA', statut=Piece.Statut.VALIDE, ordre=0, numero=None):
        return Piece.objects.create(
            ssdgps=self.ssdgps, session=None, type_piece=type_piece, numero=numero,
            ordre=ordre, statut=statut, payload={'rows': [{'a': 1}]})

    def transition(self, action, motif=None):
        corps = {'action': action}
        if motif is not None:
            corps['motif'] = motif
        return self.client.post(f'/api/v1/ssdgps/{self.ssdgps.id}/transition/',
                                corps, format='json')

    def statut(self):
        self.ssdgps.refresh_from_db()
        return self.ssdgps.statut


class SoumissionTests(WorkflowBaseTest):
    def test_un_dossier_demarre_en_cours(self):
        self.assertEqual(self.ssdgps.statut, Ssdgps.Statut.EN_COURS)
        self.assertFalse(self.ssdgps.est_verrouille())

    def test_le_redacteur_soumet_un_dossier_entierement_valide(self):
        self._piece()

        resp = self.transition('soumettre')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.statut(), Ssdgps.Statut.SOUMIS)

    def test_une_piece_non_validee_empeche_la_soumission(self):
        self._piece()
        self._piece('ROB', statut=Piece.Statut.BROUILLON, ordre=1)

        resp = self.transition('soumettre')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('ne sont pas validées', resp.data['detail'])
        self.assertEqual(self.statut(), Ssdgps.Statut.EN_COURS)

    def test_une_piece_supprimee_n_empeche_pas_la_soumission(self):
        self._piece()
        brouillon = self._piece('ROB', statut=Piece.Statut.BROUILLON, ordre=1)
        brouillon.is_deleted = True
        brouillon.save(update_fields=['is_deleted'])

        resp = self.transition('soumettre')

        self.assertEqual(resp.status_code, 200, resp.data)

    def test_un_dossier_sans_piece_ne_se_soumet_pas(self):
        resp = self.transition('soumettre')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('aucune pièce', resp.data['detail'])

    def test_le_message_nomme_les_pieces_fautives(self):
        self._piece('ROB', statut=Piece.Statut.BROUILLON)

        resp = self.transition('soumettre')

        self.assertIn('Rapport des Observations Brutes', resp.data['detail'])

    def test_on_ne_soumet_pas_deux_fois(self):
        self._piece()
        self.transition('soumettre')

        resp = self.transition('soumettre')

        self.assertEqual(resp.status_code, 400)
        self.assertIn("n'est possible que depuis", resp.data['detail'])


class DecisionsDeLEncadrementTests(WorkflowBaseTest):
    def setUp(self):
        super().setUp()
        self._piece()
        self.transition('soumettre')

    def test_un_agent_ne_valide_pas_son_propre_dossier(self):
        resp = self.transition('valider')

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.statut(), Ssdgps.Statut.SOUMIS)

    def test_l_admin_organisation_valide(self):
        self.client.force_authenticate(self.admin)

        resp = self.transition('valider')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.statut(), Ssdgps.Statut.VALIDE)

    def test_l_admin_de_l_application_valide_aussi(self):
        app_admin = User.objects.create_user(username='sa@sdgps.ma', email='sa@sdgps.ma',
                                             password='Passw0rd!', is_superuser=True)
        self.client.force_authenticate(app_admin)

        resp = self.transition('valider')

        self.assertEqual(resp.status_code, 200, resp.data)

    def test_le_rejet_exige_un_motif(self):
        self.client.force_authenticate(self.admin)

        resp = self.transition('rejeter')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('motif', resp.data['detail'].lower())
        self.assertEqual(self.statut(), Ssdgps.Statut.SOUMIS)

    def test_le_rejet_renvoie_en_saisie_avec_son_motif(self):
        self.client.force_authenticate(self.admin)

        resp = self.transition('rejeter', motif='Coordonnées de la LPA à reprendre.')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.statut(), Ssdgps.Statut.EN_COURS)
        self.ssdgps.refresh_from_db()
        self.assertEqual(self.ssdgps.motif_statut, 'Coordonnées de la LPA à reprendre.')
        self.assertEqual(self.ssdgps.statut_change_by, self.admin)

    def test_la_cloture_suit_la_validation(self):
        self.client.force_authenticate(self.admin)
        self.transition('valider')

        resp = self.transition('clore')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.statut(), Ssdgps.Statut.CLOS)

    def test_on_ne_clot_pas_un_dossier_non_valide(self):
        self.client.force_authenticate(self.admin)

        resp = self.transition('clore')

        self.assertEqual(resp.status_code, 400)

    def test_la_reouverture_exige_un_motif_et_ramene_en_saisie(self):
        self.client.force_authenticate(self.admin)
        self.transition('valider')

        sans_motif = self.transition('rouvrir')
        avec_motif = self.transition('rouvrir', motif='Erreur de saisie constatée.')

        self.assertEqual(sans_motif.status_code, 400)
        self.assertEqual(avec_motif.status_code, 200, avec_motif.data)
        self.assertEqual(self.statut(), Ssdgps.Statut.EN_COURS)

    def test_une_transition_inconnue_est_refusee(self):
        self.client.force_authenticate(self.admin)

        resp = self.transition('archiver')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('inconnue', resp.data['detail'])


class VerrouDuContenuTests(WorkflowBaseTest):
    """Dès « soumis », le contenu est figé : un dossier qui bouge n'est pas contrôlable."""

    def setUp(self):
        super().setUp()
        self.piece = self._piece()
        self.transition('soumettre')

    def test_une_piece_n_est_plus_modifiable(self):
        resp = self.client.patch(f'/api/v1/pieces/{self.piece.id}/',
                                 {'commentaire': 'après coup'}, format='json')

        self.assertEqual(resp.status_code, 403)
        self.piece.refresh_from_db()
        self.assertEqual(self.piece.commentaire, '')

    def test_une_piece_n_est_plus_supprimable(self):
        resp = self.client.delete(f'/api/v1/pieces/{self.piece.id}/')

        self.assertEqual(resp.status_code, 403)

    def test_aucune_piece_ne_s_ajoute_plus(self):
        resp = self.client.post('/api/v1/pieces/', {
            'type_piece': 'ROB', 'ssdgps': str(self.ssdgps.id),
            'source_saisie': 'manuel', 'payload': {'rows': [{'a': 1}]},
        }, format='json')

        self.assertEqual(resp.status_code, 403)

    def test_la_lecture_reste_ouverte(self):
        resp = self.client.get(f'/api/v1/pieces/?ssdgps={self.ssdgps.id}')

        self.assertEqual(resp.status_code, 200)

    def test_le_rejet_redonne_la_main(self):
        self.client.force_authenticate(self.admin)
        self.transition('rejeter', motif='À corriger.')
        self.client.force_authenticate(self.agent)

        resp = self.client.patch(f'/api/v1/pieces/{self.piece.id}/',
                                 {'commentaire': 'corrigé'}, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)

    def test_un_dossier_valide_reste_verrouille(self):
        self.client.force_authenticate(self.admin)
        self.transition('valider')

        resp = self.client.patch(f'/api/v1/pieces/{self.piece.id}/',
                                 {'commentaire': 'x'}, format='json')

        self.assertEqual(resp.status_code, 403)

    def test_une_piece_en_corbeille_n_est_plus_restaurable(self):
        self.piece.is_deleted = True
        self.piece.save(update_fields=['is_deleted'])

        resp = self.client.post(f'/api/v1/pieces/{self.piece.id}/restore/')

        self.assertEqual(resp.status_code, 403)

    def test_la_restauration_en_masse_ecarte_les_dossiers_verrouilles(self):
        self.piece.is_deleted = True
        self.piece.save(update_fields=['is_deleted'])

        resp = self.client.post('/api/v1/pieces/bulk-restore/',
                                {'ids': [str(self.piece.id)]}, format='json')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['restored_count'], 0)
        self.assertEqual(resp.data['verrouillees_count'], 1)

    def test_le_rapport_reste_generable(self):
        # Le verrou porte sur l'ÉCRITURE. Un dossier validé doit pouvoir sortir son PDF.
        resp = self.client.get(f'/api/v1/pieces/report-check/?ssdgps={self.ssdgps.id}')

        self.assertEqual(resp.status_code, 200)


class ExpositionEtJournalTests(WorkflowBaseTest):
    def test_le_detail_expose_le_statut_et_les_transitions_possibles(self):
        self._piece()

        resp = self.client.get(f'/api/v1/ssdgps/{self.ssdgps.id}/')

        self.assertEqual(resp.data['statut'], 'en_cours')
        self.assertEqual(resp.data['statut_display'], 'En cours')
        self.assertFalse(resp.data['verrouille'])
        self.assertIn('soumettre', resp.data['transitions'])

    def test_un_agent_ne_se_voit_pas_proposer_de_valider(self):
        self._piece()
        self.transition('soumettre')

        resp = self.client.get(f'/api/v1/ssdgps/{self.ssdgps.id}/')

        self.assertEqual(resp.data['transitions'], [])
        self.assertTrue(resp.data['verrouille'])

    def test_l_encadrement_se_voit_proposer_valider_et_rejeter(self):
        self._piece()
        self.transition('soumettre')
        self.client.force_authenticate(self.admin)

        resp = self.client.get(f'/api/v1/ssdgps/{self.ssdgps.id}/')

        self.assertEqual(set(resp.data['transitions']), {'valider', 'rejeter'})

    def test_le_statut_ne_se_modifie_pas_par_un_patch_direct(self):
        # Les règles vivent dans la transition : un champ libre reviendrait à ne pas les avoir.
        resp = self.client.patch(f'/api/v1/ssdgps/{self.ssdgps.id}/',
                                 {'statut': 'valide'}, format='json')

        self.assertEqual(self.statut(), Ssdgps.Statut.EN_COURS)
        self.assertEqual(resp.data['statut'], 'en_cours')

    def test_chaque_decision_est_journalisee(self):
        self._piece()
        self.transition('soumettre')
        self.client.force_authenticate(self.admin)
        self.transition('rejeter', motif='LPA à reprendre.')

        evenements = AuditEvent.objects.filter(
            action=AuditEvent.ACTION_SSDGPS_STATUT).order_by('created_at')
        self.assertEqual(evenements.count(), 2)
        dernier = evenements.last()
        self.assertEqual(dernier.details['transition'], 'rejeter')
        self.assertEqual(dernier.details['statut_avant'], 'soumis')
        self.assertEqual(dernier.details['statut_apres'], 'en_cours')
        self.assertEqual(dernier.details['motif'], 'LPA à reprendre.')
        self.assertEqual(dernier.acteur_email, self.admin.email)


class RolesUnitairesTests(WorkflowBaseTest):
    def test_un_agent_n_est_pas_l_encadrement(self):
        self.assertFalse(est_encadrement(self.agent, self.org.id))

    def test_un_admin_d_une_autre_organisation_n_est_pas_l_encadrement_ici(self):
        autre = Organization.objects.create(code='ORG-WF2', name='Autre')
        etranger = User.objects.create_user(username='et@sdgps.ma', email='et@sdgps.ma',
                                            password='Passw0rd!')
        Membership.objects.create(user=etranger, organization=autre,
                                  role='ROLE_ORGANISATION_ADMIN')

        self.assertFalse(est_encadrement(etranger, self.org.id))

    def test_une_adhesion_desactivee_ne_donne_plus_la_decision(self):
        Membership.objects.filter(user=self.admin, organization=self.org).update(
            is_active=False)

        self.assertFalse(est_encadrement(self.admin, self.org.id))

    def test_un_dossier_clos_n_offre_que_la_reouverture(self):
        self.ssdgps.statut = Ssdgps.Statut.CLOS

        self.assertEqual(transitions_possibles(self.ssdgps, self.admin, self.org.id),
                         ['rouvrir'])
