"""Tests du health-check racine du backend (backend/urls.py).

Quand le SPA n'est pas embarqué (backend local servi seul — cas dev/staging/preprod/
production en local), la racine `/` renvoie un mini JSON de santé au lieu d'un 404.
En prod Railway (SPA embarqué), la racine sert l'app : ce comportement n'est pas testé ici.
"""
from django.test import TestCase


class RootHealthCheckTests(TestCase):
    def test_root_returns_health_ok(self):
        resp = self.client.get('/')
        # En environnement de test, aucun build Angular n'est embarqué → route health active.
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['message'], 'API SDGPS OK')
        self.assertIn('SDGPS', data['service'])
        self.assertEqual(data['api'], '/api/')
