"""
`manage.py reinitialiser_sequences` — séquences d'identifiants recalées.

Constaté sur Railway (PostgreSQL) : la séquence de `pieces_pieceimage` était en retard sur
la table ; chaque photo importée recevait un identifiant déjà pris (`IntegrityError …
_pkey`) et l'import en masse en perdait par séries. La commande, lancée à chaque
démarrage du conteneur et après une restauration, recale toutes les séquences.
"""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.db import connection
from django.test import TestCase

from accounts.management.commands.reinitialiser_sequences import reinitialiser_sequences


class ReinitialiserSequencesTests(TestCase):
    def test_execute_les_instructions_du_moteur_pour_tous_les_modeles(self):
        """Les instructions de recalage fournies par le moteur sont toutes exécutées, et
        couvrent la table des images de pièces."""
        vues = {}

        def fausses_instructions(style, modeles):
            vues['tables'] = {m._meta.db_table for m in modeles}
            return ['SELECT 1', 'SELECT 2']

        with mock.patch.object(connection.ops, 'sequence_reset_sql', side_effect=fausses_instructions):
            self.assertEqual(reinitialiser_sequences(), 2)
        self.assertIn('pieces_pieceimage', vues['tables'])
        self.assertIn('pieces_piece', vues['tables'])

    def test_commande_sans_sequence_sqlite(self):
        sortie = StringIO()
        with mock.patch.object(connection.ops, 'sequence_reset_sql', return_value=[]):
            call_command('reinitialiser_sequences', stdout=sortie)
        self.assertIn('Aucune séquence', sortie.getvalue())

    def test_commande_reelle_sans_erreur(self):
        """Sur le moteur réel (SQLite en test), la commande s'exécute sans erreur."""
        sortie = StringIO()
        call_command('reinitialiser_sequences', stdout=sortie)
        self.assertTrue(sortie.getvalue())

    def test_entrypoint_et_restauration_l_appellent(self):
        from pathlib import Path
        racine = Path(__file__).resolve().parents[1]
        self.assertIn('reinitialiser_sequences', (racine / 'docker-entrypoint.sh').read_text(encoding='utf-8'))
        self.assertIn('reinitialiser_sequences',
                      (racine / 'platform_admin' / 'sauvegardes.py').read_text(encoding='utf-8'))
