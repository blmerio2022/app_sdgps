"""Tests de l'amorçage des données MÉTIER (accounts.seeding._seed_business_data).

Deux niveaux :
- des tests UNITAIRES avec un jeu de données synthétique minimal passé à `run_seed(...)`
  (rapides, précis : résolution des FK naturelles, idempotence, horodatages, médias) ;
- un test de FUMÉE sur le fichier embarqué réel (`business_data.json`) : il se charge, seede
  la cascade complète et reste idempotent.

Le signal post_migrate est neutralisé pendant les tests (settings.TESTING) ; `run_seed()` est
donc appelé explicitement.
"""
import tempfile
from unittest import mock
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from accounts import seeding
from accounts.seeding import run_seed, load_business_data, _copy_seed_media
from pieces.models import Piece, PieceImage, PieceFieldMeta
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()

# --- Jeu de données synthétique minimal (une entité par niveau de la cascade) ---
PROJ_ID = '11111111-1111-1111-1111-111111111111'
PROP_ID = '22222222-2222-2222-2222-222222222222'
AFF_ID = '33333333-3333-3333-3333-333333333333'
SS_ID = '44444444-4444-4444-4444-444444444444'
SESS_ID = '55555555-5555-5555-5555-555555555555'
PIECE_ID = '66666666-6666-6666-6666-666666666666'
IMG_ID = 9001

REFERENCE = {
    'organizations': [{
        'code': 'BIZ-ORG', 'name': 'Organisation Métier', 'type': 'PUBLIC',
        'is_active': True, 'is_test_data': False,
    }],
    'users': [{
        'email': 'creator@sdgps.ma', 'password': 'MotDePasse@2026',
        'first_name': 'Créa', 'last_name': 'Teur',
    }],
    'organismes_niveau1': [{'code': 'ANCFCC', 'nom': 'ANCFCC', 'sigle': 'ANCFCC'}],
    'organismes_niveau2': [{
        'code': 'SCA-X', 'nom': 'Service X', 'ville': 'Rabat', 'niveau1_code': 'ANCFCC',
    }],
}


def _audit(created='2025-01-01T10:00:00+00:00', updated='2025-01-02T10:00:00+00:00'):
    return {
        'is_deleted': False, 'deleted_at': None,
        'created_by': 'creator@sdgps.ma', 'updated_by': None, 'deleted_by': None,
        'created_at': created, 'updated_at': updated,
    }


BUSINESS = {
    'projets': [{
        'id': PROJ_ID, 'code_projet': 'BIZ-1', 'nom_projet': 'Projet Métier',
        'description_projet': 'desc', 'statut': 'en_cours', 'organization_code': 'BIZ-ORG',
        **_audit(),
    }],
    'proprietes': [{
        'id': PROP_ID, 'projet_id': PROJ_ID, 'nom_propriete': 'Propriété A',
        'id_requisition': 'R100/1', 'id_titre': '',
        'organisme_niveau1_code': 'ANCFCC', 'organisme_niveau2_code': 'SCA-X', **_audit(),
    }],
    'affaires': [{
        'id': AFF_ID, 'propriete_id': PROP_ID, 'numero_sd_affaire': 1,
        'nature_procedure_affaire': 'IFF', 'nature_affaire': 'BI',
        'date_bornage': '2025-01-05T09:00:00+00:00', **_audit(),
    }],
    'ssdgps': [{
        'id': SS_ID, 'affaire_id': AFF_ID, 'nature_ssdgps': 'PDC/GPS',
        'numero_ssdgps': 1, 'type_ssdgps': 'mono-session', **_audit(),
    }],
    'sessions': [{
        'id': SESS_ID, 'ssdgps_id': SS_ID, 'numero_session': 1,
        'date_session': '2025-01-06T08:00:00+00:00', **_audit(),
    }],
    'pieces': [{
        'id': PIECE_ID, 'ssdgps_id': SS_ID, 'session_id': None, 'type_piece': 'RDC',
        'numero': None, 'fichier': None, 'taille_octets': 0, 'ordre': 1,
        'payload': {'rows': [{'a': 1}]}, 'source_saisie': 'manuel', 'statut': 'valide',
        'orientation': 'auto', 'versions_rapport': 'both', 'commentaire': '', **_audit(),
    }],
    'piece_images': [{
        'id': IMG_ID, 'piece_id': PIECE_ID, 'fichier': 'pieces/x/RDC/images/a.jpg',
        'apercu': None, 'ordre': 0, 'point_ref': '', 'format': 'JPEG',
        'taille_octets': 123, 'largeur': 10, 'hauteur': 20, 'mode_couleur': 'RGB',
        'compression': '', 'date_creation': None, 'date_modification': None,
        'created_at': '2025-01-06T08:00:00+00:00',
    }],
    'piece_field_meta': [{
        'type_piece': 'RDC', 'field_name': 'champ_test', 'description': 'Desc',
        'tooltip': 'Info', 'required': True,
    }],
    'media_files': [],
}


class SeedBusinessDataTests(TestCase):
    def test_cree_la_cascade_complete(self):
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        self.assertTrue(Projet.objects.filter(pk=PROJ_ID).exists())
        self.assertTrue(Propriete.objects.filter(pk=PROP_ID).exists())
        self.assertTrue(Affaire.objects.filter(pk=AFF_ID).exists())
        self.assertTrue(Ssdgps.objects.filter(pk=SS_ID).exists())
        self.assertTrue(Session.objects.filter(pk=SESS_ID).exists())
        self.assertTrue(Piece.objects.filter(pk=PIECE_ID).exists())
        self.assertTrue(PieceImage.objects.filter(pk=IMG_ID).exists())
        self.assertTrue(
            PieceFieldMeta.objects.filter(type_piece='RDC', field_name='champ_test').exists())

    def test_resout_les_fk_naturelles(self):
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        projet = Projet.objects.get(pk=PROJ_ID)
        self.assertEqual(projet.organization.code, 'BIZ-ORG')
        self.assertEqual(projet.created_by.email, 'creator@sdgps.ma')
        prop = Propriete.objects.get(pk=PROP_ID)
        self.assertEqual(prop.organisme_niveau1.code, 'ANCFCC')
        self.assertEqual(prop.organisme_niveau2.code, 'SCA-X')
        self.assertEqual(prop.projet_id, projet.id)

    def test_preserve_payload_et_horodatages(self):
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        piece = Piece.objects.get(pk=PIECE_ID)
        self.assertEqual(piece.payload, {'rows': [{'a': 1}]})
        projet = Projet.objects.get(pk=PROJ_ID)
        # created_at du snapshot réappliqué malgré auto_now_add.
        self.assertEqual(projet.created_at.isoformat(), '2025-01-01T10:00:00+00:00')
        self.assertEqual(projet.updated_at.isoformat(), '2025-01-02T10:00:00+00:00')

    def test_compteurs_dans_le_summary(self):
        summary = run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        self.assertEqual(summary['projets_created'], 1)
        self.assertEqual(summary['proprietes_created'], 1)
        self.assertEqual(summary['affaires_created'], 1)
        self.assertEqual(summary['ssdgps_created'], 1)
        self.assertEqual(summary['sessions_created'], 1)
        self.assertEqual(summary['pieces_created'], 1)
        self.assertEqual(summary['piece_images_created'], 1)
        self.assertEqual(summary['piece_field_meta_created'], 1)

    def test_idempotent(self):
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        second = run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        for key in ('projets_created', 'proprietes_created', 'affaires_created',
                    'ssdgps_created', 'sessions_created', 'pieces_created',
                    'piece_images_created', 'piece_field_meta_created'):
            self.assertEqual(second.get(key, 0), 0, key)
        # Aucun doublon.
        self.assertEqual(Projet.objects.filter(pk=PROJ_ID).count(), 1)
        self.assertEqual(Piece.objects.filter(pk=PIECE_ID).count(), 1)
        self.assertEqual(
            PieceFieldMeta.objects.filter(type_piece='RDC', field_name='champ_test').count(), 1)

    def test_projet_ignore_si_organisation_absente(self):
        biz = {**BUSINESS, 'projets': [{
            **BUSINESS['projets'][0], 'id': PROJ_ID,
            'organization_code': 'CODE-INEXISTANT',
        }], 'proprietes': [], 'affaires': [], 'ssdgps': [], 'sessions': [],
            'pieces': [], 'piece_images': [], 'piece_field_meta': []}
        summary = run_seed(data=REFERENCE, business_data=biz, avec_metier=True)
        self.assertEqual(summary.get('projets_created', 0), 0)
        self.assertFalse(Projet.objects.filter(pk=PROJ_ID).exists())

    def test_numero_ssdgps_deja_pris_dans_l_application_n_interrompt_pas_le_seed(self):
        # Un SSDGPS créé dans l'application a pris le n°1 de l'affaire : le seed écarte la
        # ligne du snapshot (et ses pièces) au lieu de planter sur la contrainte d'unicité,
        # et ne touche pas à la donnée de l'opérateur.
        import uuid
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)
        Ssdgps.objects.filter(pk=SS_ID).delete()
        local = Ssdgps.objects.create(affaire_id=AFF_ID, nature_ssdgps='DDC/GPS', numero_ssdgps=1,
                                      type_ssdgps='mono-session', id=uuid.uuid4())
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)   # ne lève pas
        self.assertFalse(Ssdgps.objects.filter(pk=SS_ID).exists())
        local.refresh_from_db()
        self.assertEqual(local.nature_ssdgps, 'DDC/GPS')
        self.assertFalse(Piece.objects.filter(pk=PIECE_ID, ssdgps_id=SS_ID).exists())

    def test_business_data_vide_ne_cree_pas_les_entites_du_snapshot(self):
        # Un dict métier vide n'injecte aucune entité du snapshot (rétro-compatibilité).
        # NB : la base de test contient déjà des projets de démo (migrations de données) ;
        # on vérifie donc l'absence de NOS entités synthétiques, pas une base vide.
        run_seed(data=REFERENCE, business_data={})
        self.assertFalse(Projet.objects.filter(pk=PROJ_ID).exists())
        self.assertFalse(Piece.objects.filter(pk=PIECE_ID).exists())


class CopySeedMediaTests(TestCase):
    def test_copie_idempotente_des_binaires(self):
        with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as dst_dir:
            rel = 'pieces/abc/RDC/images/photo.jpg'
            src_file = Path(src_dir) / rel
            src_file.parent.mkdir(parents=True, exist_ok=True)
            src_file.write_bytes(b'binary-content')

            with override_settings(MEDIA_ROOT=dst_dir):
                original = seeding.SEED_MEDIA_DIR
                seeding.SEED_MEDIA_DIR = Path(src_dir)
                try:
                    copied = _copy_seed_media([rel], lambda m: None)
                    self.assertEqual(copied, 1)
                    dst_file = Path(dst_dir) / rel
                    self.assertTrue(dst_file.exists())
                    self.assertEqual(dst_file.read_bytes(), b'binary-content')
                    # Second passage : fichier déjà présent → 0 copie.
                    self.assertEqual(_copy_seed_media([rel], lambda m: None), 0)
                finally:
                    seeding.SEED_MEDIA_DIR = original


class EmbeddedBusinessFileTests(TestCase):
    """Test de fumée sur le fichier embarqué réel (business_data.json)."""

    def test_le_fichier_embarque_se_seede_et_est_idempotent(self):
        embedded = load_business_data()
        if not embedded:
            self.skipTest("Aucun business_data.json embarqué")
        # MEDIA_ROOT temporaire pour ne pas polluer le répertoire médias de travail.
        # NB : on vérifie l'EXISTENCE des entités du snapshot (par PK/code) et l'idempotence,
        # sans compteurs absolus (la base de test porte déjà des données de démo).
        with tempfile.TemporaryDirectory() as media_dir, override_settings(MEDIA_ROOT=media_dir):
            run_seed(avec_metier=True)  # charge initial_data.json + business_data.json
            for row in embedded['projets']:
                self.assertTrue(Projet.objects.filter(pk=row['id'],
                                                      code_projet=row['code_projet']).exists(),
                                f"projet manquant : {row['code_projet']}")
            for row in embedded['pieces']:
                self.assertTrue(Piece.objects.filter(pk=row['id']).exists())
            for row in embedded['piece_images']:
                self.assertTrue(PieceImage.objects.filter(pk=row['id']).exists())
            # Chaque code de projet du snapshot est unique (pas de doublon migration/seed).
            for row in embedded['projets']:
                self.assertEqual(Projet.objects.filter(code_projet=row['code_projet']).count(), 1)

            second = run_seed(avec_metier=True)
            self.assertEqual(second.get('projets_created', 0), 0)
            self.assertEqual(second.get('pieces_created', 0), 0)
            self.assertEqual(second.get('sessions_created', 0), 0)


class SeedAuDemarrageNeRessusciteRienTests(TestCase):
    """Régression : à chaque déploiement, `migrate` relançait le seed, qui rejouait le
    snapshot métier par `update_or_create` — les éléments supprimés définitivement
    réapparaissaient, ceux de la corbeille en sortaient, les modifications étaient
    écrasées. Le seed AUTOMATIQUE (sans `avec_metier`) ne touche plus aux données métier."""

    def setUp(self):
        run_seed(data=REFERENCE, business_data=BUSINESS, avec_metier=True)   # base « en service »

    def test_supprime_definitivement_reste_supprime(self):
        Projet.objects.filter(pk=PROJ_ID).delete()                # suppression définitive (cascade)
        run_seed(data=REFERENCE, business_data=BUSINESS)        # = démarrage du conteneur
        self.assertFalse(Projet.objects.filter(pk=PROJ_ID).exists())
        self.assertFalse(Ssdgps.objects.filter(pk=SS_ID).exists())
        self.assertFalse(Piece.objects.filter(pk=PIECE_ID).exists())

    def test_corbeille_et_modifications_conservees(self):
        Affaire.objects.filter(pk=AFF_ID).update(is_deleted=True)
        Piece.objects.filter(pk=PIECE_ID).update(payload={'rows': [{'a': 2}]}, statut='brouillon')
        PieceFieldMeta.objects.filter(field_name='champ_test').update(description='Modifiée par l’admin')
        run_seed(data=REFERENCE, business_data=BUSINESS)
        self.assertTrue(Affaire.objects.get(pk=AFF_ID).is_deleted)
        piece = Piece.objects.get(pk=PIECE_ID)
        self.assertEqual((piece.payload, piece.statut), ({'rows': [{'a': 2}]}, 'brouillon'))
        self.assertEqual(PieceFieldMeta.objects.get(field_name='champ_test').description, 'Modifiée par l’admin')

    def test_recepteur_post_migrate_ne_demande_pas_les_donnees_metier(self):
        from accounts.apps import seed_reference_data
        with mock.patch('accounts.seeding.run_seed', return_value={
                'users_created': 0, 'organizations_created': 0, 'organismes_created': 0}) as seed, \
                self.settings(TESTING=False):
            seed_reference_data(sender=None)
        seed.assert_called_once_with()
        self.assertFalse(seed.call_args.kwargs.get('avec_metier', False))


class SeedMetaChampsBaseNeuveTests(TestCase):
    def test_meta_champs_crees_meme_sans_donnees_metier(self):
        """Base neuve : les métadonnées de champs (référence) sont créées par le seed
        automatique ; la cascade métier, elle, ne l'est pas."""
        run_seed(data=REFERENCE, business_data=BUSINESS)
        self.assertTrue(PieceFieldMeta.objects.filter(field_name='champ_test').exists())
        self.assertFalse(Projet.objects.filter(pk=PROJ_ID).exists())
