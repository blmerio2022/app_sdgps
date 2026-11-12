"""
Tests de la protection des endpoints d'authentification contre la force brute.

Couvre les deux mécanismes complémentaires :
- la **limitation de débit** (`accounts/throttling.py`), par IP et par compte visé ;
- le **verrouillage temporaire** du compte après des échecs répétés
  (`accounts/lockout.py`), qui seul arrête une attaque lente.

Et la non-divulgation du code de réinitialisation dans la réponse HTTP lorsque l'envoi
de l'email échoue.

Chaque test repart d'un cache vide : compteurs et verrous y vivent, et le cache est
partagé entre les tests d'un même processus.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from . import lockout

User = get_user_model()

LOGIN_URL = '/api/auth/login/'
FORGOT_URL = '/api/auth/forgot-password/'
VERIFY_URL = '/api/auth/verify-code/'

MOT_DE_PASSE = 'Passw0rd!2026'

# Débits volontairement bas pour que les tests restent lisibles et rapides.
DEBITS_DE_TEST = {
    'login_ip': '1000/min',
    'login_email': '1000/min',
    'forgot_password_ip': '3/hour',
    'forgot_password_email': '2/hour',
    'verify_code_ip': '1000/hour',
    'verify_code_email': '3/hour',
    'reset_password_ip': '1000/hour',
    'reset_password_email': '1000/hour',
}


def rest_framework_avec(debits):
    """Config REST_FRAMEWORK du projet, avec les débits remplacés."""
    from django.conf import settings

    config = dict(settings.REST_FRAMEWORK)
    config['DEFAULT_THROTTLE_RATES'] = debits
    return config


class BaseAuthTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='agent@example.com', email='agent@example.com', password=MOT_DE_PASSE,
        )

    def tearDown(self):
        cache.clear()


class VerrouillageDeCompteTests(BaseAuthTests):
    """Verrouillage temporaire après `MAX_TENTATIVES` échecs."""

    def echec(self, email='agent@example.com'):
        return self.client.post(
            LOGIN_URL, {'email': email, 'password': 'mauvais'}, format='json',
        )

    def test_un_echec_renvoie_401_et_decompte_les_essais(self):
        resp = self.echec()

        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data['code'], 'INVALID_PASSWORD')
        self.assertEqual(resp.data['remaining_attempts'], lockout.MAX_TENTATIVES - 1)

    def test_le_compte_est_verrouille_au_seuil(self):
        for _ in range(lockout.MAX_TENTATIVES - 1):
            self.echec()

        resp = self.echec()

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['code'], 'ACCOUNT_LOCKED')
        self.assertGreater(resp.data['retry_after'], 0)

    def test_le_bon_mot_de_passe_est_refuse_pendant_le_verrou(self):
        """Le cœur du mécanisme : le verrou tient même avec les bons identifiants."""
        for _ in range(lockout.MAX_TENTATIVES):
            self.echec()

        resp = self.client.post(
            LOGIN_URL, {'email': 'agent@example.com', 'password': MOT_DE_PASSE}, format='json',
        )

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['code'], 'ACCOUNT_LOCKED')

    def test_une_connexion_reussie_efface_le_compteur(self):
        for _ in range(lockout.MAX_TENTATIVES - 1):
            self.echec()

        ok = self.client.post(
            LOGIN_URL, {'email': 'agent@example.com', 'password': MOT_DE_PASSE}, format='json',
        )
        self.assertEqual(ok.status_code, 200)

        # Le compteur est reparti de zéro : un nouvel échec n'est pas le dernier.
        resp = self.echec()
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data['remaining_attempts'], lockout.MAX_TENTATIVES - 1)

    def test_le_verrou_ne_touche_que_le_compte_vise(self):
        autre = User.objects.create_user(
            username='autre@example.com', email='autre@example.com', password=MOT_DE_PASSE,
        )
        for _ in range(lockout.MAX_TENTATIVES):
            self.echec()

        resp = self.client.post(
            LOGIN_URL, {'email': autre.email, 'password': MOT_DE_PASSE}, format='json',
        )

        self.assertEqual(resp.status_code, 200)

    def test_un_email_inconnu_ne_cree_pas_de_verrou(self):
        """Rien à verrouiller : inutile de remplir le cache depuis l'extérieur."""
        for _ in range(lockout.MAX_TENTATIVES + 2):
            resp = self.echec(email='inconnu@example.com')

        self.assertEqual(resp.status_code, 404)
        self.assertFalse(lockout.est_verrouille('inconnu@example.com'))

    def test_la_casse_de_l_email_ne_contourne_pas_le_verrou(self):
        for _ in range(lockout.MAX_TENTATIVES):
            self.echec()

        self.assertTrue(lockout.est_verrouille('AGENT@Example.COM'))

    def test_secondes_restantes_vaut_zero_sans_verrou(self):
        self.assertEqual(lockout.secondes_restantes('agent@example.com'), 0)
        self.assertEqual(lockout.secondes_restantes(''), 0)

    def test_effacer_echecs_leve_le_verrou(self):
        for _ in range(lockout.MAX_TENTATIVES):
            self.echec()
        self.assertTrue(lockout.est_verrouille('agent@example.com'))

        lockout.effacer_echecs('agent@example.com')

        self.assertFalse(lockout.est_verrouille('agent@example.com'))


@override_settings(REST_FRAMEWORK=rest_framework_avec(DEBITS_DE_TEST))
class LimitationDeDebitTests(BaseAuthTests):
    """Les limites de débit renvoient 429 une fois le quota dépassé."""

    def setUp(self):
        super().setUp()
        # `SimpleRateThrottle.THROTTLE_RATES` est lié au dictionnaire des réglages AU
        # MOMENT DE L'IMPORT : `override_settings` ne le suit pas. On le remplace donc
        # explicitement — et on le restaure en sortie, sinon les débits de test
        # fuiraient vers tous les autres tests du même processus.
        from rest_framework.throttling import SimpleRateThrottle

        self._debits_initiaux = SimpleRateThrottle.THROTTLE_RATES
        SimpleRateThrottle.THROTTLE_RATES = DEBITS_DE_TEST

    def tearDown(self):
        from rest_framework.throttling import SimpleRateThrottle

        SimpleRateThrottle.THROTTLE_RATES = self._debits_initiaux
        super().tearDown()

    @patch('accounts.views.EmailService')
    def test_forgot_password_limite_par_compte_vise(self, email_service):
        email_service.return_value.send_password_reset_code.return_value = True
        donnees = {'email': 'agent@example.com'}

        self.assertEqual(self.client.post(FORGOT_URL, donnees, format='json').status_code, 200)
        self.assertEqual(self.client.post(FORGOT_URL, donnees, format='json').status_code, 200)
        resp = self.client.post(FORGOT_URL, donnees, format='json')

        self.assertEqual(resp.status_code, 429)

    @patch('accounts.views.EmailService')
    def test_forgot_password_limite_aussi_par_ip(self, email_service):
        """Changer de cible ne contourne pas la limite : l'IP est comptée à part."""
        email_service.return_value.send_password_reset_code.return_value = True

        for indice in range(3):
            resp = self.client.post(
                FORGOT_URL, {'email': f'cible{indice}@example.com'}, format='json',
            )
            self.assertEqual(resp.status_code, 200, resp.data)

        resp = self.client.post(FORGOT_URL, {'email': 'cible9@example.com'}, format='json')
        self.assertEqual(resp.status_code, 429)

    def test_verify_code_limite_les_essais_par_compte(self):
        donnees = {'email': 'agent@example.com', 'code': '000000'}

        for _ in range(3):
            self.assertEqual(self.client.post(VERIFY_URL, donnees, format='json').status_code, 400)

        self.assertEqual(self.client.post(VERIFY_URL, donnees, format='json').status_code, 429)

    def test_une_requete_sans_email_n_est_pas_limitee_par_compte(self):
        """La limite par compte ne doit pas se replier sur une clé commune."""
        for _ in range(5):
            resp = self.client.post(VERIFY_URL, {'code': '000000'}, format='json')
            self.assertEqual(resp.status_code, 400)


class ThrottleParEmailTests(TestCase):
    """Construction de la clé de cache des limites par compte visé."""

    def setUp(self):
        from .throttling import LoginEmailThrottle

        self.throttle = LoginEmailThrottle()

    def _requete(self, data):
        class _Req:
            pass

        req = _Req()
        req.data = data
        return req

    def test_la_cle_ne_contient_pas_l_email_en_clair(self):
        cle = self.throttle.get_cache_key(self._requete({'email': 'agent@example.com'}), None)

        self.assertIsNotNone(cle)
        self.assertNotIn('agent@example.com', cle)

    def test_la_cle_est_insensible_a_la_casse_et_aux_espaces(self):
        a = self.throttle.get_cache_key(self._requete({'email': 'agent@example.com'}), None)
        b = self.throttle.get_cache_key(self._requete({'email': '  Agent@Example.com '}), None)

        self.assertEqual(a, b)

    def test_pas_de_cle_sans_email(self):
        self.assertIsNone(self.throttle.get_cache_key(self._requete({}), None))
        self.assertIsNone(self.throttle.get_cache_key(self._requete({'email': ''}), None))
        self.assertIsNone(self.throttle.get_cache_key(self._requete({'email': 42}), None))

    def test_deux_comptes_ont_des_cles_distinctes(self):
        a = self.throttle.get_cache_key(self._requete({'email': 'a@example.com'}), None)
        b = self.throttle.get_cache_key(self._requete({'email': 'b@example.com'}), None)

        self.assertNotEqual(a, b)


class CodeDeReinitialisationNonDivulgueTests(BaseAuthTests):
    """Le code ne doit jamais sortir dans la réponse HTTP hors poste de développement."""

    @patch('accounts.views.EmailService')
    def _demander(self, email_service, envoi_reussi=False):
        email_service.return_value.send_password_reset_code.return_value = envoi_reussi
        return self.client.post(FORGOT_URL, {'email': 'agent@example.com'}, format='json')

    @override_settings(DEBUG=False)
    def test_pas_de_code_dans_la_reponse_quand_l_envoi_echoue(self):
        resp = self._demander()

        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('code', resp.data)

    @override_settings(DEBUG=True, IS_SERVER_ENV=True)
    def test_pas_de_code_en_environnement_serveur_meme_en_debug(self):
        resp = self._demander()

        self.assertNotIn('code', resp.data)

    @override_settings(DEBUG=True, IS_SERVER_ENV=False)
    def test_le_code_reste_disponible_sur_un_poste_de_developpement(self):
        resp = self._demander()

        self.assertIn('code', resp.data)
        self.assertEqual(len(resp.data['code']), 6)

    @override_settings(DEBUG=False)
    @patch('accounts.views.EmailService')
    def test_rien_ne_fuit_non_plus_quand_l_envoi_reussit(self, email_service):
        email_service.return_value.send_password_reset_code.return_value = True

        resp = self.client.post(FORGOT_URL, {'email': 'agent@example.com'}, format='json')

        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('code', resp.data)


class MessageDeConnexionTests(BaseAuthTests):
    """L'inscription publique n'existe plus : le message d'erreur ne la propose plus."""

    def test_email_inconnu_ne_propose_plus_de_creer_un_compte(self):
        resp = self.client.post(
            LOGIN_URL, {'email': 'inconnu@example.com', 'password': 'x'}, format='json',
        )

        self.assertEqual(resp.status_code, 404)
        self.assertNotIn('suggestion', resp.data)
        self.assertNotIn('créer un compte', resp.data['message'].lower())


class ClaimsDuJetonTests(BaseAuthTests):
    """Claims portés par le JWT émis à la connexion.

    `getOrganizationId()` côté front renvoyait toujours `null` faute de claim `org_id`.
    Les claims posés sur le refresh token sont recopiés dans l'access token, y compris
    après rafraîchissement.
    """

    def _claims(self, token):
        import base64
        import json

        charge = token.split('.')[1]
        charge += '=' * (-len(charge) % 4)
        return json.loads(base64.urlsafe_b64decode(charge))

    def _connexion(self):
        resp = self.client.post(
            '/api/auth/login/',
            {'email': 'agent@example.com', 'password': MOT_DE_PASSE},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data

    def test_le_jeton_porte_l_identifiant_utilisateur(self):
        """simplejwt le sérialise en CHAÎNE — le front doit donc le convertir avant
        toute comparaison numérique (cf. `AuthService.extractOrganizationInfo`)."""
        claims = self._claims(self._connexion()['token'])

        self.assertEqual(str(claims['user_id']), str(self.user.pk))

    def test_le_jeton_porte_l_organisation(self):
        from accounts.models import Membership, Organization

        org = Organization.objects.create(code='ORG-J', name='Organisation Jeton')
        Membership.objects.create(
            user=self.user, organization=org, role='ROLE_ORGANISATION_AGENT',
        )

        claims = self._claims(self._connexion()['token'])

        self.assertEqual(claims['org_id'], str(org.id))

    def test_org_id_est_vide_sans_organisation(self):
        """Un compte sans adhésion (super admin, compte isolé) reste connectable."""
        claims = self._claims(self._connexion()['token'])

        self.assertEqual(claims['org_id'], '')

    def test_les_claims_de_role_sont_toujours_presents(self):
        claims = self._claims(self._connexion()['token'])

        self.assertIn('role', claims)
        self.assertIn('platform_role', claims)
        self.assertIn('is_superuser', claims)

    def test_les_claims_survivent_au_rafraichissement(self):
        """Sinon le front perdrait le rôle au bout de 8 h, sans erreur visible."""
        from accounts.models import Membership, Organization

        org = Organization.objects.create(code='ORG-K', name='Organisation K')
        Membership.objects.create(
            user=self.user, organization=org, role='ROLE_ORGANISATION_AGENT',
        )
        donnees = self._connexion()

        resp = self.client.post(
            '/api/auth/token/refresh/', {'refresh': donnees['refresh_token']}, format='json',
        )

        self.assertEqual(resp.status_code, 200, resp.data)
        claims = self._claims(resp.data['access'])
        self.assertEqual(claims['org_id'], str(org.id))
        self.assertEqual(claims['role'], 'ROLE_ORGANISATION_AGENT')
