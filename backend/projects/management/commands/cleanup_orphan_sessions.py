"""
Nettoie les sessions ORPHELINES des SSDGPS mono-session.

Contexte — un SSDGPS mono-session n'a qu'UNE session, implicite et structurelle
(auto-créée par ``projects.signals.autocreate_mono_session``) : le front ne descend
jamais au niveau session pour ce type, et l'API expose ``nbr_total_sessions`` à 0. Toute
session supplémentaire est donc **invisible et inatteignable**.

Faute de validation côté API, deux chemins ont produit cet état (désormais fermés, cf.
``projects/serializers.py``) : ajouter une session à un mono-session, ou basculer un
multi-session en mono alors qu'il comptait plusieurs sessions.

Cette commande ne supprime **que les sessions excédentaires VIDES** (aucune pièce
active), en **suppression logique** — donc réversible, et traçée via
``deleted_by``/``deleted_at`` comme tout le reste de l'app.

Prudence délibérée : la session conservée est celle qui porte des pièces ; à défaut, la
plus petite par ``numero_session``. Si **plusieurs** sessions portent des pièces, le
SSDGPS est **laissé intact** et signalé : la fusion relève d'un arbitrage métier, pas
d'un script.

Usage ::

    python manage.py cleanup_orphan_sessions --dry-run     # inventaire, n'écrit rien
    python manage.py cleanup_orphan_sessions --yes         # dev / staging
    python manage.py cleanup_orphan_sessions --confirm-environment production
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from projects.models import Session, Ssdgps


class Command(BaseCommand):
    help = ("Supprime (logiquement) les sessions excédentaires VIDES des SSDGPS "
            "mono-session. Confirmation graduée : --yes en dev/staging, "
            "--confirm-environment <nom> en preprod/production.")

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help="Inventaire seul : n'écrit rien.")
        parser.add_argument('--yes', action='store_true',
                            help="Confirme l'action en dev/staging.")
        parser.add_argument('--confirm-environment', dest='confirm_environment',
                            default=None,
                            help="Nom EXACT de l'environnement (preprod/production).")

    def handle(self, *args, **options):
        dry = options['dry_run']
        env = getattr(settings, 'ENVIRONMENT', 'development')

        # --- Inventaire : mono-session comptant plus d'une session active -------
        candidats = (Ssdgps.objects
                     .filter(type_ssdgps=Ssdgps.TypeSSDGPS.MONO)
                     .annotate(n=Count('sessions',
                                       filter=Q(sessions__is_deleted=False),
                                       distinct=True))
                     .filter(n__gt=1)
                     .select_related('affaire__propriete'))

        plan, bloques = [], []
        for ssdgps in candidats:
            sessions = list(ssdgps.sessions.filter(is_deleted=False)
                            .order_by('numero_session'))
            avec_pieces = [s for s in sessions
                           if s.pieces.filter(is_deleted=False).exists()]

            if len(avec_pieces) > 1:
                bloques.append((ssdgps, sessions, avec_pieces))
                continue

            # Session conservée : celle qui porte des pièces, sinon la première.
            gardee = avec_pieces[0] if avec_pieces else sessions[0]
            a_supprimer = [s for s in sessions if s.pk != gardee.pk]
            if a_supprimer:
                plan.append((ssdgps, gardee, a_supprimer))

        total = sum(len(s) for _o, _g, s in plan)
        self.stdout.write(
            f"SSDGPS mono-session incohérents : {len(candidats)} "
            f"— {len(plan)} nettoyables, {len(bloques)} à arbitrer.")

        for ssdgps, gardee, a_supprimer in plan:
            self.stdout.write(
                f"  SDGPS n°{ssdgps.numero_ssdgps} ({ssdgps.pk}) : "
                f"garde la session n°{gardee.numero_session}, "
                f"supprime {', '.join('n°%s' % s.numero_session for s in a_supprimer)}")

        for ssdgps, sessions, avec_pieces in bloques:
            self.stdout.write(self.style.WARNING(
                f"  ⚠ SDGPS n°{ssdgps.numero_ssdgps} ({ssdgps.pk}) LAISSÉ INTACT : "
                f"{len(avec_pieces)} sessions portent des pièces "
                f"({', '.join('n°%s' % s.numero_session for s in avec_pieces)}). "
                "Arbitrage métier requis — repassez-le en multi-session, ou "
                "déplacez les pièces avant de relancer."))

        if not total:
            self.stdout.write(self.style.SUCCESS("Aucune session orpheline à supprimer."))
            return

        if dry:
            self.stdout.write(self.style.WARNING(
                f"--dry-run : {total} session(s) seraient supprimées. Rien n'a été écrit."))
            return

        # --- Confirmation graduée (même politique que `reset_db`) ---------------
        if getattr(settings, 'IS_PRODUCTION_LIKE', False):
            if options['confirm_environment'] != env:
                raise CommandError(
                    f"Environnement « {env} » de type production.\n"
                    f"   Le flag --yes ne suffit pas ici. Confirmez explicitement avec :\n"
                    f"       --confirm-environment {env}\n"
                    "   Sauvegardez la base avant toute opération destructive.")
        elif not options['yes']:
            raise CommandError(
                f"Suppression logique de {total} session(s) sur « {env} ». "
                "Relancez avec --yes pour confirmer.")

        maintenant = timezone.now()
        supprimees = 0
        with transaction.atomic():
            for _ssdgps, _gardee, a_supprimer in plan:
                ids = [s.pk for s in a_supprimer]
                supprimees += Session.objects.filter(pk__in=ids).update(
                    is_deleted=True, deleted_at=maintenant)

        self.stdout.write(self.style.SUCCESS(
            f"{supprimees} session(s) orpheline(s) supprimée(s) logiquement. "
            "Réversible : remettre `is_deleted=False` les restaure."))
