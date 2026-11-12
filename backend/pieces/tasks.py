"""
Tâches de fond des pièces — génération des rapports PDF.

Le rendu d'un rapport dure des dizaines de secondes à plusieurs minutes. Mené dans la
requête HTTP, il immobilisait un worker gunicorn sur trois, dépassait le délai du
serveur sur un gros SDGPS, et ne pouvait afficher qu'une progression simulée.

Ici, la tâche :
1. passe le suivi en « en cours » ;
2. recompose la portée du rapport (SSDGPS seul, session unique, ou plage de synthèse)
   — **depuis la base**, jamais depuis des objets sérialisés : une tâche peut démarrer
   plusieurs secondes après la demande, et doit travailler sur l'état courant ;
3. rend le PDF en publiant une progression RÉELLE à chaque pièce ;
4. enregistre le fichier, qui devient re-téléchargeable.

Toute défaillance se termine en statut « échec » porteur d'un message exploitable :
l'opérateur doit savoir ce qui a manqué, pas voir une barre figée.
"""
import logging

from celery import shared_task
from django.core.files.base import ContentFile
from django.utils import timezone

# Importés au niveau module (et non dans la tâche) : `report.py` ne charge aucune
# bibliothèque native à l'import — WeasyPrint n'est requis qu'au rendu — et c'est ce
# qui rend le rendu remplaçable par un bouchon dans les tests.
from .report import render_report_pdf, report_filename

logger = logging.getLogger(__name__)


def _pieces_de_la_generation(generation):
    """Pièces à inclure, dans l'ordre du rapport, relues en base.

    Reproduit la portée choisie à la demande :
    - plage de sessions → regroupement « une pièce, puis ses sessions » (synthèse) ;
    - session unique → pièces de cette session + pièces communes ;
    - ni l'un ni l'autre → tout le SSDGPS.
    """
    from django.db.models import Q

    from .models import Piece
    from .report import EXCLUDED_TYPES, order_pieces_for_synthesis

    qs = Piece.objects.filter(
        ssdgps_id=generation.ssdgps_id, is_deleted=False, statut=Piece.Statut.VALIDE,
    ).exclude(type_piece__in=EXCLUDED_TYPES)

    if generation.sessions_plage:
        qs = qs.filter(
            Q(session_id__in=generation.sessions_plage) | Q(session__isnull=True)
        )
        return order_pieces_for_synthesis(
            list(qs.select_related('session').order_by('ordre', 'type_piece', 'numero'))
        )

    if generation.session_id:
        qs = qs.filter(Q(session_id=generation.session_id) | Q(session__isnull=True))

    return list(qs.order_by('ordre', 'type_piece', 'numero'))


def _echouer(generation, message):
    generation.statut = generation.Statut.ECHEC
    generation.erreur = message
    generation.finished_at = timezone.now()
    generation.save(update_fields=['statut', 'erreur', 'finished_at'])


@shared_task(bind=True, name='pieces.generer_rapport')
def generer_rapport(self, generation_id):
    """Rend le rapport d'une `RapportGeneration` et y attache le PDF produit."""
    from accounts.audit import journaliser
    from accounts.models import AuditEvent

    from .models import RapportGeneration

    generation = RapportGeneration.objects.select_related(
        'ssdgps', 'session', 'created_by',
    ).filter(pk=generation_id).first()
    if generation is None:
        logger.warning('Génération de rapport introuvable : %s', generation_id)
        return None

    generation.statut = RapportGeneration.Statut.EN_COURS
    generation.started_at = timezone.now()
    generation.progression = 5
    generation.etape = 'Préparation des pièces'
    generation.tache_id = getattr(self.request, 'id', '') or ''
    generation.save(update_fields=['statut', 'started_at', 'progression', 'etape', 'tache_id'])

    try:
        pieces = _pieces_de_la_generation(generation)
        if not pieces:
            _echouer(generation, 'Aucune pièce valide à inclure dans le rapport.')
            return None

        sessions_plage = None
        if generation.sessions_plage:
            from projects.models import Session

            sessions_plage = list(
                Session.objects.filter(pk__in=generation.sessions_plage)
                .order_by('numero_session')
            )

        auteur = generation.created_by
        sort_config = getattr(auteur, 'piece_sort_config', None) or {}
        fields_config = getattr(auteur, 'piece_fields_config', None) or {}

        pdf_bytes = render_report_pdf(
            generation.ssdgps, generation.session, pieces,
            sort_config=sort_config, fields_config=fields_config,
            duplex=generation.duplex,
            on_progress=lambda faites, total, etape: generation.marquer_progression(
                faites, total, etape,
            ),
        )

        nom = report_filename(generation.ssdgps, generation.session, sessions=sessions_plage)
        generation.fichier.save(nom, ContentFile(pdf_bytes), save=False)
        generation.nom_fichier = nom
        generation.octets = len(pdf_bytes)
        generation.statut = RapportGeneration.Statut.TERMINE
        generation.progression = 100
        generation.etape = 'Terminé'
        generation.erreur = ''
        generation.finished_at = timezone.now()
        generation.save()

        # Traçabilité : une génération ne modifie aucune donnée, les colonnes d'audit
        # n'en gardent donc rien (cf. `accounts/audit.py`).
        journaliser(
            AuditEvent.ACTION_RAPPORT_GENERE, acteur=auteur, cible=generation.ssdgps,
            cible_libelle=str(generation.ssdgps), fichier=nom,
            sessions=([s.numero_session for s in sessions_plage] if sessions_plage else None),
            octets=len(pdf_bytes), asynchrone=True,
        )
        return str(generation.pk)

    except RuntimeError as exc:
        # Chaîne PDF indisponible (bibliothèque native manquante) : message actionnable.
        logger.error('Rapport PDF indisponible (SSDGPS %s) : %s', generation.ssdgps_id, exc)
        _echouer(generation, str(exc))
    except Exception as exc:  # noqa: BLE001 - on veut un statut d'échec, pas une trace muette
        logger.exception('Échec de génération du rapport (SSDGPS %s)', generation.ssdgps_id)
        _echouer(
            generation,
            f'Échec de la génération du rapport PDF : {type(exc).__name__} — {exc}. '
            'Le détail complet figure dans les journaux du serveur.',
        )
    return None
