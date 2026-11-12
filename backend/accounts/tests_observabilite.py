"""
Tests de l'observabilité backend (Sentry) et du backend de cache.

L'exigence centrale est négative : sans `SENTRY_DSN`, RIEN ne doit être initialisé —
ni client, ni appel réseau. C'est l'état du dépôt par défaut, et celui de la CI.

Second point : la confidentialité. L'application manipule des données foncières
nominatives, qui n'ont pas à être recopiées chez un tiers — `send_default_pii` doit
rester désactivé (ni cookies, ni corps de requête, ni adresse IP).

Troisième point : le cache. Il porte les compteurs de limitation de débit et les
verrous de compte ; avec plusieurs workers, un cache local les rend inopérants.
"""
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase

from backend.observability import configuration_du_cache, configurer_sentry

DSN = 'https://cle@exemple.ingest.sentry.io/1'


class SentryDesactiveTests(TestCase):
    def test_aucun_dsn_configure_dans_le_depot(self):
        """Le DSN est un secret : il vient de l'environnement, jamais du code."""
        self.assertEqual(getattr(settings, 'SENTRY_DSN', ''), '')

    def test_rien_n_est_initialise_sans_dsn(self):
        with patch('sentry_sdk.init') as init:
            actif = configurer_sentry(dsn='', environnement='development')

        self.assertFalse(actif)
        init.assert_not_called()

    def test_un_dsn_vide_de_sens_ne_suffit_pas(self):
        with patch('sentry_sdk.init') as init:
            self.assertFalse(configurer_sentry(dsn='   ', environnement='development'))
            self.assertFalse(configurer_sentry(dsn=None, environnement='development'))

        init.assert_not_called()


class SentryActifTests(TestCase):
    def _init_avec(self, **kwargs):
        with patch('sentry_sdk.init') as init:
            actif = configurer_sentry(dsn=DSN, environnement='preprod', **kwargs)
        self.assertTrue(actif)
        return init.call_args.kwargs

    def test_sentry_est_initialise_avec_un_dsn(self):
        options = self._init_avec()

        self.assertEqual(options['dsn'], DSN)

    def test_aucune_donnee_personnelle_n_est_envoyee(self):
        self.assertFalse(self._init_avec()['send_default_pii'])

    def test_l_environnement_est_transmis(self):
        self.assertEqual(self._init_avec()['environment'], 'preprod')

    def test_pas_de_traces_de_performance_par_defaut(self):
        """Chaque trace est facturée : on ne les active que sur décision explicite."""
        self.assertEqual(self._init_avec()['traces_sample_rate'], 0.0)

    def test_le_taux_de_traces_est_reglable(self):
        self.assertEqual(self._init_avec(traces_sample_rate=0.25)['traces_sample_rate'], 0.25)

    def test_le_dsn_est_nettoye(self):
        with patch('sentry_sdk.init') as init:
            configurer_sentry(dsn=f'  {DSN}  ', environnement='development')

        self.assertEqual(init.call_args.kwargs['dsn'], DSN)

    def test_l_integration_django_est_branchee(self):
        options = self._init_avec()
        noms = [type(i).__name__ for i in options['integrations']]

        self.assertIn('DjangoIntegration', noms)


class ConfigurationDuCacheTests(TestCase):
    def test_sans_redis_le_cache_est_local(self):
        config = configuration_du_cache('')

        self.assertIn('locmem', config['default']['BACKEND'].lower())

    def test_avec_redis_le_cache_est_partage(self):
        config = configuration_du_cache('redis://localhost:6379/0')

        self.assertIn('redis', config['default']['BACKEND'].lower())
        self.assertEqual(config['default']['LOCATION'], 'redis://localhost:6379/0')

    def test_une_url_vide_de_sens_retombe_sur_le_cache_local(self):
        self.assertIn('locmem', configuration_du_cache('   ')['default']['BACKEND'].lower())
        self.assertIn('locmem', configuration_du_cache(None)['default']['BACKEND'].lower())

    def test_le_projet_a_bien_un_cache_configure(self):
        """Sans `CACHES` explicite, Django en fournit un par défaut : on vérifie que le
        nôtre est bien celui en place, puisque la sécurité en dépend."""
        self.assertEqual(settings.CACHES['default']['LOCATION'], 'sdgps-local')
