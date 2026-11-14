"""Version de l'application : calcul depuis git, fichier de build, endpoint public."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest import mock, skipUnless

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from backend import version as v

GIT = shutil.which('git') is not None


class FormatTests(SimpleTestCase):
    def test_format(self):
        self.assertEqual(v.formater('1.0', 34), 'v1.0.34')
        self.assertEqual(v.formater('1.1', 0), 'v1.1.0')
        self.assertEqual(v.formater('1.0', 34, local=True), 'v1.0.34+local')

    def test_repere(self):
        self.assertEqual(v.majeure_mineure_du_repere('base/v1.0'), '1.0')
        self.assertEqual(v.majeure_mineure_du_repere('base/v12.3'), '12.3')
        self.assertIsNone(v.majeure_mineure_du_repere('v1.0.0'))
        self.assertIsNone(v.majeure_mineure_du_repere('base/v1'))
        self.assertIsNone(v.majeure_mineure_du_repere(''))


@skipUnless(GIT, 'git requis')
class CalculDepuisGitTests(SimpleTestCase):
    """Dépôt jetable : le numéro suit les commits de la branche, fusions comprises."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.git('init', '-q', '-b', 'develop')
        self.git('config', 'user.email', 't@t.t')
        self.git('config', 'user.name', 't')
        (self.dir / 'backend').mkdir()
        self.commit('depart')
        self.git('tag', 'base/v1.0')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.dir, check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, nom):
        (self.dir / 'backend' / f'{nom}.txt').write_text(nom)
        self.git('add', '-A')
        self.git('commit', '-q', '-m', nom)

    def version(self):
        return v.calculer_depuis_git(cwd=self.dir)['version']

    def test_compte_les_commits_depuis_le_repere(self):
        self.assertEqual(self.version(), 'v1.0.0')
        self.commit('a')
        self.commit('b')
        info = v.calculer_depuis_git(cwd=self.dir)
        self.assertEqual(info['version'], 'v1.0.2')
        self.assertEqual(info['commit'], self.git('rev-parse', '--short', 'HEAD'))
        self.assertTrue(info['date_commit'] and info['date_build'])

    def test_fusion_de_develop_ajoute_un_et_ne_fait_jamais_reculer(self):
        self.git('checkout', '-q', '-b', 'feature/v1.0')
        self.commit('a')
        self.commit('b')                       # v1.0.2
        self.git('checkout', '-q', 'develop')
        for i in range(5):
            self.commit(f'd{i}')               # 5 commits côté develop
        self.git('checkout', '-q', 'feature/v1.0')
        self.git('merge', '-q', '--no-ff', '-m', 'fusion develop', 'develop')
        self.assertEqual(self.version(), 'v1.0.3')

    def test_modification_non_commitee_marquee_local(self):
        (self.dir / 'backend' / 'depart.txt').write_text('modifié')
        self.assertEqual(self.version(), 'v1.0.0+local')

    def test_fichier_non_suivi_ignore(self):
        (self.dir / 'backend' / 'nouveau.txt').write_text('x')
        self.assertEqual(self.version(), 'v1.0.0')

    def test_repere_le_plus_recent(self):
        self.commit('a')
        self.git('tag', 'base/v1.1')
        self.commit('b')
        self.assertEqual(self.version(), 'v1.1.1')

    def test_sans_repere_leve(self):
        self.git('tag', '-d', 'base/v1.0')
        with self.assertRaises(RuntimeError):
            v.calculer_depuis_git(cwd=self.dir)

    def test_script_ecrit_le_fichier(self):
        cible = self.dir / 'build-info' / 'version.json'
        with mock.patch.object(v, 'RACINE_DEPOT', self.dir), \
                mock.patch.object(v, 'calculer_depuis_git',
                                  lambda: {'version': 'v1.0.0', 'commit': 'abc'}):
            self.assertEqual(v._main(['--ecrire', str(cible)]), 0)
        self.assertEqual(json.loads(cible.read_text(encoding='utf-8'))['version'], 'v1.0.0')
        self.assertEqual(v._main([]), 2)


class VersionInfoTests(SimpleTestCase):
    def setUp(self):
        v.version_info.cache_clear()
        self.addCleanup(v.version_info.cache_clear)
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def test_fichier_de_build_prioritaire(self):
        f = self.dir / 'version.json'
        f.write_text(json.dumps({'version': 'v1.0.7', 'commit': 'abc1234'}), encoding='utf-8')
        with mock.patch.object(v, 'FICHIERS_VERSION', (self.dir / 'absent.json', f)):
            info = v.version_info()
        self.assertEqual(info['version'], 'v1.0.7')
        self.assertEqual(info['date_build'], '')            # champs manquants complétés

    def test_repli_git_puis_inconnue(self):
        with mock.patch.object(v, 'FICHIERS_VERSION', (self.dir / 'absent.json',)), \
                mock.patch.object(v, 'calculer_depuis_git', side_effect=RuntimeError('pas de git')):
            self.assertEqual(v.version_info()['version'], v.INCONNUE)

    def test_fichier_illisible_ignore(self):
        f = self.dir / 'version.json'
        f.write_text('{pas du json', encoding='utf-8')
        with mock.patch.object(v, 'FICHIERS_VERSION', (f,)), \
                mock.patch.object(v, 'calculer_depuis_git', return_value={'version': 'v1.0.1'}):
            self.assertEqual(v.version_info()['version'], 'v1.0.1')


@override_settings(ENVIRONMENT='staging')
class VersionEndpointTests(TestCase):
    url = '/api/version/'

    def setUp(self):
        self.patch = mock.patch('backend.api_version.version_info', return_value={
            'version': 'v1.0.34', 'commit': 'e7d0fc1',
            'date_commit': '2026-11-14T17:26:30Z', 'date_build': '2026-11-14T18:00:00+00:00'})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_public_sans_authentification(self):
        r = APIClient().get(self.url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {
            'version': 'v1.0.34', 'commit': 'e7d0fc1', 'date_commit': '2026-11-14T17:26:30Z',
            'date_build': '2026-11-14T18:00:00+00:00', 'environnement': 'staging'})
        self.assertEqual(r['Cache-Control'], 'no-store')

    def test_jeton_invalide_ignore(self):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Bearer jeton-expire')
        self.assertEqual(c.get(self.url).status_code, 200)

    def test_lecture_seule(self):
        self.assertEqual(APIClient().post(self.url, {}).status_code, 405)

    def test_rien_de_sensible(self):
        cles = set(APIClient().get(self.url).json())
        self.assertEqual(cles, {'version', 'commit', 'date_commit', 'date_build', 'environnement'})
