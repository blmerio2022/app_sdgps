"""
Bascule vers un stockage objet S3-compatible (Scaleway / OVH / MinIO / AWS).

`backend/settings.py` choisit le backend de stockage selon la seule présence de
`AWS_STORAGE_BUCKET_NAME`. Ces tests valident ce chemin **sans aucun compte payant** :
`moto` est démarré en véritable **serveur HTTP S3 local**, et `django-storages` s'y
connecte exactement comme il le fera sur Scaleway — même client boto3, mêmes signatures
`s3v4`, même `AWS_S3_ENDPOINT_URL` pointant vers un hôte non-AWS.

Le serveur HTTP est indispensable ici : en mode « patch » (`mock_aws`), moto ne
reconnaît pas un endpoint tiers et refuse la requête. Or c'est précisément le cas
d'usage à éprouver — viser un fournisseur qui n'est pas Amazon.

Ce qui est verrouillé :
  1. un `AWS_S3_ENDPOINT_URL` explicite est respecté — c'est LUI qui rend le
     fournisseur interchangeable (sans endpoint, boto3 irait chez Amazon) ;
  2. un fichier téléversé atterrit réellement comme objet dans le bucket, intact ;
  3. l'URL servie est signée et expirante (`AWS_QUERYSTRING_AUTH`), pour qu'une pièce
     cadastrale ne devienne pas lisible par simple lien ;
  4. `AWS_S3_FILE_OVERWRITE = False` empêche deux envois homonymes de s'écraser.

Les identifiants sont factices et n'ont de sens que pour le serveur local.
"""
import unittest
from io import BytesIO

import boto3
from django.core.files.base import ContentFile
from django.test import SimpleTestCase

try:
    from moto.server import ThreadedMotoServer
    MOTO_SERVEUR_DISPONIBLE = True
except Exception:          # moto[server] est un outil de test, pas une dépendance d'exécution
    MOTO_SERVEUR_DISPONIBLE = False
    ThreadedMotoServer = None

BUCKET = 'sdgps-staging'
REGION = 'fr-par'          # région Scaleway Paris, celle visée en staging
CLE = 'cle-factice'
SECRET = 'secret-factice'


@unittest.skipUnless(MOTO_SERVEUR_DISPONIBLE,
                     "moto[server] absent (pip install 'moto[server]' flask flask-cors)")
class BasculeStockageObjetTests(SimpleTestCase):
    """Un seul serveur S3 local pour toute la classe ; le bucket est recréé par test."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.serveur = ThreadedMotoServer(port=0, verbose=False)
        cls.serveur.start()
        hote, port = cls.serveur.get_host_and_port()
        # L'hôte annoncé est 0.0.0.0 (écoute) : on s'y connecte via 127.0.0.1.
        cls.endpoint = f'http://127.0.0.1:{port}'

    @classmethod
    def tearDownClass(cls):
        cls.serveur.stop()
        super().tearDownClass()

    def setUp(self):
        self.client = boto3.client(
            's3', region_name=REGION, endpoint_url=self.endpoint,
            aws_access_key_id=CLE, aws_secret_access_key=SECRET)
        # Table rase entre les tests (le serveur, lui, persiste).
        for seau in self.client.list_buckets().get('Buckets', []):
            contenu = self.client.list_objects_v2(Bucket=seau['Name']).get('Contents', [])
            for objet in contenu:
                self.client.delete_object(Bucket=seau['Name'], Key=objet['Key'])
            self.client.delete_bucket(Bucket=seau['Name'])
        self.client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={'LocationConstraint': REGION})
        self.storage = self._s3_storage()

    def _s3_storage(self):
        """`S3Storage` configuré comme le sera le staging Scaleway.

        Les options sont passées au constructeur plutôt que par `override_settings` :
        les `STORAGES` de Django sont résolus au chargement des settings, alors que
        c'est le backend lui-même que l'on veut éprouver ici."""
        from storages.backends.s3 import S3Storage
        return S3Storage(
            bucket_name=BUCKET,
            region_name=REGION,
            endpoint_url=self.endpoint,
            access_key=CLE,
            secret_key=SECRET,
            default_acl=None,
            querystring_auth=True,
            querystring_expire=3600,
            file_overwrite=False,
            signature_version='s3v4',
        )

    def _objets(self):
        reponse = self.client.list_objects_v2(Bucket=BUCKET)
        return [o['Key'] for o in reponse.get('Contents', [])]

    # --- configuration ----------------------------------------------------

    def test_endpoint_non_aws_respecte(self):
        """Sans endpoint explicite, boto3 viserait AWS : ce réglage est ce qui rend le
        fournisseur interchangeable (Scaleway, OVH, MinIO…)."""
        self.assertEqual(self.storage.endpoint_url, self.endpoint)
        self.assertEqual(self.storage.bucket_name, BUCKET)

    # --- aller-retour des fichiers ---------------------------------------

    def test_fichier_televerse_devient_un_objet_du_bucket(self):
        nom = self.storage.save('pieces/2026/11/plan.png', ContentFile(b'contenu-binaire'))
        self.assertIn(nom, self._objets())

    def test_contenu_relu_identique(self):
        nom = self.storage.save('pieces/aller-retour.bin', ContentFile(b'octets-exacts'))
        with self.storage.open(nom) as f:
            self.assertEqual(f.read(), b'octets-exacts')

    def test_taille_coherente(self):
        donnees = b'x' * 4096
        nom = self.storage.save('pieces/taille.bin', ContentFile(donnees))
        self.assertEqual(self.storage.size(nom), len(donnees))

    def test_image_reelle_transportee_sans_alteration(self):
        """Contenu binaire non trivial : le stockage objet ne doit ni ré-encoder ni
        tronquer une image de pièce."""
        from PIL import Image
        buf = BytesIO()
        Image.new('RGB', (120, 80), (200, 40, 40)).save(buf, format='PNG')
        attendu = buf.getvalue()

        nom = self.storage.save('pieces/photo.png', ContentFile(attendu))
        with self.storage.open(nom) as f:
            relu = f.read()
        self.assertEqual(relu, attendu)
        self.assertEqual(Image.open(BytesIO(relu)).size, (120, 80))

    # --- confidentialité et intégrité ------------------------------------

    def test_url_signee_et_expirante(self):
        """Les objets ne sont pas publics : l'URL doit porter une signature datée.
        Sans cela, toute pièce cadastrale serait lisible par simple lien."""
        nom = self.storage.save('pieces/prive.png', ContentFile(b'secret'))
        url = self.storage.url(nom)
        self.assertIn('X-Amz-Signature', url)
        self.assertIn('X-Amz-Expires', url)

    def test_pas_d_ecrasement_entre_homonymes(self):
        """`file_overwrite=False` : deux envois du même nom coexistent (suffixe ajouté)
        au lieu que le second détruise le premier."""
        a = self.storage.save('pieces/doublon.png', ContentFile(b'premier'))
        b = self.storage.save('pieces/doublon.png', ContentFile(b'second'))
        self.assertNotEqual(a, b)
        self.assertEqual(len(self._objets()), 2)
        with self.storage.open(a) as f:
            self.assertEqual(f.read(), b'premier')

    def test_suppression_retire_l_objet(self):
        nom = self.storage.save('pieces/a-supprimer.png', ContentFile(b'...'))
        self.storage.delete(nom)
        self.assertNotIn(nom, self._objets())


class ConfigurationStockageTests(SimpleTestCase):
    """Le choix du backend dans `settings.py` ne dépend que de `AWS_STORAGE_BUCKET_NAME`."""

    def test_sans_bucket_le_stockage_reste_local(self):
        """En développement, aucun bucket n'est configuré : les fichiers restent sur
        disque et aucune dépendance S3 n'est sollicitée."""
        from django.conf import settings
        if settings.AWS_STORAGE_BUCKET_NAME:
            self.skipTest("Un bucket est configuré dans cet environnement.")
        self.assertIn('FileSystemStorage', settings.STORAGES['default']['BACKEND'])

    def test_django_storages_est_importable(self):
        """`django-storages` est déclaré dans requirements.txt. Son absence ferait
        échouer la bascule au DÉMARRAGE (et non à l'usage) : ce test la détecte en CI."""
        from storages.backends.s3 import S3Storage      # noqa: F401
