"""
Tests du journal d'audit (`accounts.models.AuditEvent` + `accounts.audit`).

Ce que les colonnes d'audit des tables métier ne savent pas faire, et que ce journal
doit garantir :
- conserver la trace d'actions qui ne modifient RIEN (consulter, générer un rapport) ;
- conserver l'avant/après d'un changement sensible (rôle) ;
- survivre à la suppression du compte qui a agi ;
- être **inaltérable** : ni modification, ni suppression.

Et une exigence de robustesse : journaliser ne doit JAMAIS casser l'action journalisée.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from .audit import adresse_ip_de, journaliser
from .models import AuditEvent, Membership, Organization

User = get_user_model()

MOT_DE_PASSE = 'Passw0rd!2026'


def make_user(email, is_superuser=False, platform_role=None):
    user = User.objects.create_user(username=email, email=email, password=MOT_DE_PASSE)
    if is_superuser:
        user.is_superuser = True
        user.is_staff = True
    if platform_role:
        user.platform_role = platform_role
    user.save()
    return user


class ModeleAppendOnlyTests(TestCase):
    """Un journal modifiable ne prouve rien."""

    def setUp(self):
        self.evenement = AuditEvent.objects.create(
            action=AuditEvent.ACTION_CONNEXION, acteur_email='a@example.com',
        )

    def test_une_ligne_ecrite_ne_peut_pas_etre_modifiee(self):
        self.evenement.acteur_email = 'autre@example.com'

        with self.assertRaises(ValueError):
            self.evenement.save()

    def test_une_ligne_ne_peut_pas_etre_supprimee(self):
        with self.assertRaises(ValueError):
            self.evenement.delete()

    def test_la_suppression_en_masse_est_refusee(self):
        """`Model.delete()` ne couvre que l'objet : le queryset doit refuser aussi,
        sinon la garantie append-only se contourne en une ligne."""
        with self.assertRaises(ValueError):
            AuditEvent.objects.all().delete()

    def test_la_modification_en_masse_est_refusee(self):
        with self.assertRaises(ValueError):
            AuditEvent.objects.all().update(acteur_email='x@example.com')

    def test_la_representation_est_lisible(self):
        self.assertIn('a@example.com', str(self.evenement))

    def test_les_evenements_sont_antichronologiques(self):
        recent = AuditEvent.objects.create(action=AuditEvent.ACTION_CONNEXION)

        self.assertEqual(AuditEvent.objects.first(), recent)


class HelperJournaliserTests(TestCase):
    def setUp(self):
        self.user = make_user('acteur@example.com')

    def test_l_email_de_l_acteur_est_fige(self):
        """La trace doit survivre à la suppression du compte."""
        journaliser(AuditEvent.ACTION_CONNEXION, acteur=self.user)
        self.user.delete()

        evenement = AuditEvent.objects.get()
        self.assertIsNone(evenement.acteur)
        self.assertEqual(evenement.acteur_email, 'acteur@example.com')

    def test_la_cible_est_deduite_de_l_objet(self):
        org = Organization.objects.create(code='ORG-A', name='Organisation A')

        journaliser(AuditEvent.ACTION_MEMBRE_AJOUTE, acteur=self.user, cible=org)

        evenement = AuditEvent.objects.get()
        self.assertEqual(evenement.cible_type, 'Organization')
        self.assertEqual(evenement.cible_id, str(org.pk))

    def test_les_details_sont_conserves(self):
        journaliser(AuditEvent.ACTION_ROLE_MODIFIE, acteur=self.user,
                    role_avant='A', role_apres='B')

        self.assertEqual(
            AuditEvent.objects.get().details, {'role_avant': 'A', 'role_apres': 'B'},
        )

    def test_une_panne_du_journal_ne_leve_pas(self):
        """Perdre une trace est regrettable ; refuser l'action le serait davantage."""
        with patch('accounts.models.AuditEvent.objects.create', side_effect=RuntimeError('boom')):
            resultat = journaliser(AuditEvent.ACTION_CONNEXION, acteur=self.user)

        self.assertIsNone(resultat)

    def test_les_champs_trop_longs_sont_tronques(self):
        journaliser(AuditEvent.ACTION_CONNEXION, acteur_email='x' * 400,
                    cible_libelle='y' * 400)

        evenement = AuditEvent.objects.get()
        self.assertEqual(len(evenement.acteur_email), 254)
        self.assertEqual(len(evenement.cible_libelle), 255)

    def test_sans_acteur_ni_requete(self):
        journaliser(AuditEvent.ACTION_CONNEXION_ECHEC, acteur_email='inconnu@example.com')

        evenement = AuditEvent.objects.get()
        self.assertIsNone(evenement.acteur)
        self.assertIsNone(evenement.adresse_ip)


class AdresseIPTests(TestCase):
    class _Req:
        def __init__(self, meta):
            self.META = meta

    def test_sans_requete(self):
        self.assertIsNone(adresse_ip_de(None))

    def test_adresse_directe(self):
        self.assertEqual(adresse_ip_de(self._Req({'REMOTE_ADDR': '10.0.0.1'})), '10.0.0.1')

    def test_derriere_un_proxy_on_prend_le_client_d_origine(self):
        req = self._Req({'HTTP_X_FORWARDED_FOR': '1.2.3.4, 10.0.0.9', 'REMOTE_ADDR': '10.0.0.9'})

        self.assertEqual(adresse_ip_de(req), '1.2.3.4')


class JournalisationDesActionsTests(TestCase):
    """Les actions sensibles alimentent effectivement le journal."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.superadmin = make_user('super@example.com', is_superuser=True)
        self.org = Organization.objects.create(code='ORG-J', name='Organisation J')
        self.agent = make_user('agent@example.com')
        Membership.objects.create(
            user=self.agent, organization=self.org, role='ROLE_ORGANISATION_AGENT',
        )

    def tearDown(self):
        cache.clear()

    def actions_enregistrees(self):
        return list(AuditEvent.objects.values_list('action', flat=True))

    def test_connexion_reussie(self):
        self.client.post('/api/auth/login/',
                         {'email': 'agent@example.com', 'password': MOT_DE_PASSE},
                         format='json')

        self.assertIn(AuditEvent.ACTION_CONNEXION, self.actions_enregistrees())

    def test_echec_de_connexion(self):
        self.client.post('/api/auth/login/',
                         {'email': 'agent@example.com', 'password': 'faux'},
                         format='json')

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_CONNEXION_ECHEC)
        self.assertEqual(evenement.acteur_email, 'agent@example.com')
        self.assertEqual(evenement.acteur, self.agent)
        self.assertIn('tentatives_restantes', evenement.details)

    def test_echec_sur_email_inconnu(self):
        self.client.post('/api/auth/login/',
                         {'email': 'inconnu@example.com', 'password': 'faux'},
                         format='json')

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_CONNEXION_ECHEC)
        self.assertEqual(evenement.details['motif'], 'email inconnu')

    def test_verrouillage_de_compte(self):
        from . import lockout

        for _ in range(lockout.MAX_TENTATIVES):
            self.client.post('/api/auth/login/',
                             {'email': 'agent@example.com', 'password': 'faux'},
                             format='json')

        self.assertTrue(
            AuditEvent.objects.filter(action=AuditEvent.ACTION_COMPTE_VERROUILLE).exists()
        )

    def test_creation_de_compte(self):
        self.client.force_authenticate(self.superadmin)

        self.client.post('/api/v1/users/', {
            'email': 'nouveau@example.com', 'first_name': 'N', 'last_name': 'V',
            'password': MOT_DE_PASSE, 'role': 'ROLE_ORGANISATION_AGENT',
            'organization_id': str(self.org.id),
        }, format='json')

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_COMPTE_CREE)
        self.assertEqual(evenement.cible_libelle, 'nouveau@example.com')
        self.assertEqual(evenement.acteur, self.superadmin)

    def test_changement_de_role(self):
        self.client.force_authenticate(self.superadmin)

        self.client.patch(f'/api/v1/users/{self.agent.pk}/',
                          {'role': 'ROLE_ORGANISATION_ADMIN'}, format='json')

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_ROLE_MODIFIE)
        self.assertEqual(evenement.details['role_avant'], 'ROLE_ORGANISATION_AGENT')
        self.assertEqual(evenement.details['role_apres'], 'ROLE_ORGANISATION_ADMIN')

    def test_une_modification_sans_changement_de_role_ne_journalise_pas(self):
        """Le journal doit rester lisible : pas de bruit."""
        self.client.force_authenticate(self.superadmin)

        self.client.patch(f'/api/v1/users/{self.agent.pk}/',
                          {'first_name': 'Modifié'}, format='json')

        self.assertFalse(
            AuditEvent.objects.filter(action=AuditEvent.ACTION_ROLE_MODIFIE).exists()
        )

    def test_suppression_definitive(self):
        self.agent.is_deleted = True
        self.agent.save(update_fields=['is_deleted'])
        self.client.force_authenticate(self.superadmin)

        self.client.delete(f'/api/v1/users/{self.agent.pk}/permanent/')

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_SUPPRESSION_DEFINITIVE)
        self.assertEqual(evenement.cible_libelle, 'agent@example.com')

    def test_rattachement_d_un_membre(self):
        autre = Organization.objects.create(code='ORG-K', name='Organisation K')
        self.client.force_authenticate(self.superadmin)

        self.client.post(f'/api/v1/organizations/{autre.id}/add-member/',
                         {'user': self.agent.pk, 'role': 'ROLE_ORGANISATION_AGENT'},
                         format='json')

        evenement = AuditEvent.objects.get(action=AuditEvent.ACTION_MEMBRE_AJOUTE)
        self.assertEqual(evenement.details['membre'], 'agent@example.com')


class ConsultationDuJournalTests(TestCase):
    """L'API de lecture est réservée à l'administration de l'application."""

    def setUp(self):
        self.client = APIClient()
        self.superadmin = make_user('super@example.com', is_superuser=True)
        self.admin_systeme = make_user('sys@example.com', platform_role='ROLE_ADMIN_SYSTEME')
        self.org = Organization.objects.create(code='ORG-C', name='Organisation C')
        self.org_admin = make_user('orgadmin@example.com')
        Membership.objects.create(
            user=self.org_admin, organization=self.org, role='ROLE_ORGANISATION_ADMIN',
        )

        journaliser(AuditEvent.ACTION_CONNEXION, acteur=self.superadmin)
        journaliser(AuditEvent.ACTION_RAPPORT_GENERE, acteur=self.admin_systeme,
                    cible_id='abc', fichier='rapport.pdf')

    def test_anonyme_refuse(self):
        self.assertEqual(self.client.get('/api/v1/audit-events/').status_code, 401)

    def test_admin_organisation_refuse(self):
        self.client.force_authenticate(self.org_admin)

        self.assertEqual(self.client.get('/api/v1/audit-events/').status_code, 403)

    def test_super_admin_lit_le_journal(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.get('/api/v1/audit-events/')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_admin_systeme_lit_le_journal(self):
        self.client.force_authenticate(self.admin_systeme)

        self.assertEqual(self.client.get('/api/v1/audit-events/').status_code, 200)

    def test_filtre_par_action(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.get('/api/v1/audit-events/?action=REPORT_GENERATED')

        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['action'], 'REPORT_GENERATED')

    def test_filtre_par_acteur(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.get(f'/api/v1/audit-events/?acteur={self.admin_systeme.pk}')

        self.assertEqual(len(resp.data), 1)

    def test_filtre_par_cible(self):
        self.client.force_authenticate(self.superadmin)

        self.assertEqual(len(self.client.get('/api/v1/audit-events/?cible_id=abc').data), 1)

    def test_le_libelle_de_l_action_est_fourni(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.get('/api/v1/audit-events/?action=LOGIN_OK')

        self.assertEqual(resp.data[0]['action_display'], 'Connexion réussie')

    def test_la_liste_des_actions_est_exposee(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.get('/api/v1/audit-events/actions/')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), len(AuditEvent.ACTIONS))

    def test_le_journal_est_en_lecture_seule(self):
        self.client.force_authenticate(self.superadmin)

        resp = self.client.post('/api/v1/audit-events/', {'action': 'LOGIN_OK'}, format='json')

        self.assertEqual(resp.status_code, 405)
