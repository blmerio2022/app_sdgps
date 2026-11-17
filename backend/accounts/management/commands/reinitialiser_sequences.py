"""
Recale les séquences d'identifiants (PostgreSQL) sur le plus grand identifiant présent.

Pourquoi : une séquence en retard sur sa table distribue des identifiants DÉJÀ PRIS —
chaque insertion échoue alors en `IntegrityError` (« duplicate key value violates unique
constraint …_pkey ») tant que la séquence n'a pas dépassé les lignes existantes. Constaté
sur Railway : les photos de l'import en masse étaient refusées par séries (500), la
séquence de `pieces_pieceimage` étant restée derrière des images chargées avec leur
identifiant (migration de données, chargement de sauvegarde…).

Idempotent et sans effet sur les données : lancé à CHAQUE démarrage du conteneur
(`docker-entrypoint.sh`) et après une restauration. Sur SQLite, rien à faire.

    python manage.py reinitialiser_sequences
"""
from django.apps import apps
from django.core.management.base import BaseCommand
from django.core.management.color import no_style
from django.db import connection


def reinitialiser_sequences() -> int:
    """Recale toutes les séquences ; renvoie le nombre d'instructions exécutées."""
    instructions = connection.ops.sequence_reset_sql(no_style(), apps.get_models(include_auto_created=True))
    if not instructions:
        return 0
    with connection.cursor() as curseur:
        for sql in instructions:
            curseur.execute(sql)
    return len(instructions)


class Command(BaseCommand):
    help = "Recale les séquences d'identifiants PostgreSQL sur le plus grand identifiant existant."

    def handle(self, *args, **options):
        n = reinitialiser_sequences()
        if n:
            self.stdout.write(self.style.SUCCESS(f'✅ {n} séquence(s) recalée(s).'))
        else:
            self.stdout.write('Aucune séquence à recaler (base sans séquences, ex. SQLite).')
