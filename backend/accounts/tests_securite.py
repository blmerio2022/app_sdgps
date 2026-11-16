"""
Sécurité des comptes : TOTP, connexion en deux temps, codes de secours, sessions
révocables, alertes de verrouillage, comptes inactifs, actions d'administration.
"""
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AuditEvent, DoubleAuthentification, SessionConnexion
from accounts.securite import code_au_pas, pas_courant, verifier_totp
from notifications.models import Notification

User = get_user_model()
MDP = 'Passw0rd!Sur'


class TotpTests(TestCase):
    def test_vecteur_rfc6238(self):
        # RFC 6238, annexe B (SHA1, clé ASCII « 12345678901234567890 »), T = 59 s → 94287082.
        import base64
        secret = base64.b32encode(b'12345678901234567890').decode()
        self.assertEqual(code_au_pas(secret, 59 // 30), '287082')

    def test_fenetre_et_anti_rejeu(self):
        import base64
        secret = base64.b32encode(b'12345678901234567890').decode()
        t = 1_700_000_000
        p = pas_courant(t)
        self.assertEqual(verifier_totp(secret, code_au_pas(secret, p - 1), instant=t), p - 1)
        self.assertIsNone(verifier_totp(secret, code_au_pas(secret, p - 2), instant=t))
        self.assertIsNone(verifier_totp(secret, code_au_pas(secret, p), dernier_pas=p, instant=t))
        self.assertIsNone(verifier_totp(secret, 'abc', instant=t))


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class SecuriteApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(username='u@x.ma', email='u@x.ma', password=MDP)

    def login(self, mdp=MDP):
        return self.client.post('/api/auth/login/', {'email': 'u@x.ma', 'password': mdp}, format='json')

    def activer_mfa(self):
        self.client.force_authenticate(self.user)
        secret = self.client.post('/api/auth/me/mfa/initier/').data['secret'].replace(' ', '')
        p = pas_courant()
        r = self.client.post('/api/auth/me/mfa/activer/', {'code': code_au_pas(secret, p)}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.client.force_authenticate(None)
        # L'anti-rejeu a retenu le pas courant : le prochain code valide est celui du pas suivant.
        return secret, r.data['codes_secours']

    def test_connexion_cree_une_session_et_le_jeton_porte_sid(self):
        r = self.login()
        self.assertEqual(r.status_code, 200)
        s = SessionConnexion.objects.get(utilisateur=self.user)
        from rest_framework_simplejwt.tokens import AccessToken
        self.assertEqual(AccessToken(r.data['token'])['sid'], str(s.id))

    def test_session_revoquee_refuse_meme_un_access_token_valide(self):
        jeton = self.login().data['token']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {jeton}')
        self.assertEqual(self.client.get('/api/auth/me/sessions/').status_code, 200)
        sid = SessionConnexion.objects.get().id
        self.assertEqual(self.client.post(f'/api/auth/me/sessions/{sid}/revoquer/').data['revoquees'], 1)
        self.assertEqual(self.client.get('/api/auth/me/sessions/').status_code, 401)

    def test_revoquer_les_autres_garde_la_courante(self):
        self.login()
        jeton = self.login().data['token']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {jeton}')
        sessions = self.client.get('/api/auth/me/sessions/').data
        self.assertEqual(len(sessions), 2)
        self.assertEqual(sum(s['courante'] for s in sessions), 1)
        self.assertEqual(self.client.post('/api/auth/me/sessions/revoquer-autres/').data['revoquees'], 1)
        self.assertEqual(self.client.get('/api/auth/me/sessions/').status_code, 200)

    def test_connexion_en_deux_temps(self):
        secret, _ = self.activer_mfa()
        r = self.login()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['mfa_requis'])
        self.assertNotIn('token', r.data)
        jeton = r.data['jeton_mfa']
        mauvais = self.client.post('/api/auth/login/mfa/', {'jeton_mfa': jeton, 'code': '000000'}, format='json')
        self.assertEqual(mauvais.status_code, 401)
        self.assertTrue(AuditEvent.objects.filter(action=AuditEvent.ACTION_2FA_ECHEC).exists())
        with mock.patch('accounts.securite.time.time', return_value=(pas_courant() + 1) * 30 + 1):
            bon = self.client.post('/api/auth/login/mfa/', {'jeton_mfa': jeton,
                                                            'code': code_au_pas(secret, pas_courant() + 1)},
                                   format='json')
        self.assertEqual(bon.status_code, 200, bon.data)
        self.assertIn('token', bon.data)
        self.assertTrue(SessionConnexion.objects.get().double_auth)

    def test_code_de_secours_a_usage_unique(self):
        _, codes = self.activer_mfa()
        jeton = self.login().data['jeton_mfa']
        r = self.client.post('/api/auth/login/mfa/', {'jeton_mfa': jeton, 'code': codes[0]}, format='json')
        self.assertEqual(r.status_code, 200)
        jeton = self.login().data['jeton_mfa']
        r = self.client.post('/api/auth/login/mfa/', {'jeton_mfa': jeton, 'code': codes[0]}, format='json')
        self.assertEqual(r.status_code, 401)
        self.assertEqual(len(DoubleAuthentification.objects.get().codes_secours), 7)

    def test_jeton_mfa_falsifie(self):
        r = self.client.post('/api/auth/login/mfa/', {'jeton_mfa': 'x', 'code': '123456'}, format='json')
        self.assertEqual(r.data['code'], 'MFA_EXPIRED')

    def test_desactiver_exige_mot_de_passe_et_code(self):
        _, codes = self.activer_mfa()
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post('/api/auth/me/mfa/desactiver/', {'mot_de_passe': 'x', 'code': codes[0]},
                                          format='json').status_code, 400)
        r = self.client.post('/api/auth/me/mfa/desactiver/', {'mot_de_passe': MDP, 'code': codes[1]}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data['active'])
        self.assertIn('token', self.login().data)

    def test_verrouillage_previent_l_utilisateur_et_les_admins(self):
        admin = User.objects.create_superuser(username='a@x.ma', email='a@x.ma', password=MDP)
        for _ in range(5):
            r = self.login('mauvais')
        self.assertEqual(r.data['code'], 'ACCOUNT_LOCKED')
        self.assertTrue(Notification.objects.filter(destinataire=self.user, type='SECURITE').exists())
        self.assertTrue(Notification.objects.filter(destinataire=admin, type='SECURITE').exists())
        self.assertTrue(AuditEvent.objects.filter(action=AuditEvent.ACTION_ALERTE_SECURITE).exists())

    def test_administration(self):
        self.activer_mfa()
        self.login()
        sys = User.objects.create_user(username='s@x.ma', email='s@x.ma', password=MDP,
                                       platform_role='ROLE_ADMIN_SYSTEME')
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(f'/api/v1/securite/utilisateurs/{self.user.id}/').status_code, 403)
        self.client.force_authenticate(sys)
        etat = self.client.get(f'/api/v1/securite/utilisateurs/{self.user.id}/').data
        self.assertTrue(etat['mfa']['active'])
        self.client.post(f'/api/v1/securite/utilisateurs/{self.user.id}/revoquer-sessions/')
        self.assertFalse(SessionConnexion.objects.filter(revoquee_le__isnull=True).exists())
        r = self.client.post(f'/api/v1/securite/utilisateurs/{self.user.id}/reinitialiser-mfa/')
        self.assertFalse(r.data['active'])
        sa = User.objects.create_superuser(username='sa@x.ma', email='sa@x.ma', password=MDP)
        self.assertEqual(self.client.post(f'/api/v1/securite/utilisateurs/{sa.id}/revoquer-sessions/').status_code, 403)


class ComptesInactifsTests(TestCase):
    def test_desactivation(self):
        vieux = User.objects.create_user(username='v@x.ma', email='v@x.ma', password=MDP)
        User.objects.filter(pk=vieux.pk).update(last_connection_at=timezone.now() - timedelta(days=120))
        recent = User.objects.create_user(username='r@x.ma', email='r@x.ma', password=MDP)
        User.objects.filter(pk=recent.pk).update(last_connection_at=timezone.now() - timedelta(days=5))
        sa = User.objects.create_superuser(username='sa@x.ma', email='sa@x.ma', password=MDP)
        User.objects.filter(pk=sa.pk).update(last_connection_at=timezone.now() - timedelta(days=400))
        sortie = StringIO()
        call_command('desactiver_comptes_inactifs', '--jours', '90', '--simuler', stdout=sortie)
        self.assertIn('v@x.ma', sortie.getvalue())
        vieux.refresh_from_db()
        self.assertTrue(vieux.is_active)
        call_command('desactiver_comptes_inactifs', '--jours', '90', stdout=StringIO())
        vieux.refresh_from_db(); recent.refresh_from_db(); sa.refresh_from_db()
        self.assertEqual((vieux.is_active, recent.is_active, sa.is_active), (False, True, True))
        self.assertTrue(AuditEvent.objects.filter(action=AuditEvent.ACTION_COMPTE_DESACTIVE).exists())
        self.assertTrue(Notification.objects.filter(destinataire=sa, type='SECURITE').exists())

    def test_non_configure_ou_seuil_trop_court(self):
        sortie = StringIO()
        call_command('desactiver_comptes_inactifs', stdout=sortie)
        self.assertIn('non configurée', sortie.getvalue())
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('desactiver_comptes_inactifs', '--jours', '3', stdout=StringIO())
