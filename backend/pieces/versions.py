"""
Historique des versions d'une pièce.

Avant chaque changement de `Piece.payload`, l'ANCIEN contenu est archivé en
`PieceVersion` (signal `pre_save`, donc quel que soit le chemin : modification à l'écran,
ré-import, recalcul, restauration). La version garde l'auteur et la date du contenu
remplacé (`updated_by` / `updated_at` de la pièce avant le changement).

- `comparer(a, b)` : différence ligne à ligne entre deux contenus (lignes ajoutées,
  supprimées, modifiées avec leurs cellules) ; les lignes sont rapprochées par leur `id`
  quand elles en ont un, sinon par position ;
- au plus `MAX_VERSIONS` versions par pièce : les plus anciennes sont purgées.
"""
import logging

from django.db.models import Max
from django.db.models.signals import pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

MAX_VERSIONS = 50
# Utilisateur à l'origine du changement en cours (posé par la vue avant `save()`).
ATTR_AUTEUR = '_version_remplacee_par'
ATTR_ORIGINE = '_version_origine'


def _lignes(payload):
    rows = (payload or {}).get('rows')
    return rows if isinstance(rows, list) else []


def _cle(row, index):
    if isinstance(row, dict) and row.get('id') not in (None, ''):
        return f"id:{row['id']}"
    return f"pos:{index}"


def comparer(avant, apres):
    """Différences entre deux payloads.

    Returns: {'ajoutees': [row], 'supprimees': [row], 'modifiees': [{'avant', 'apres',
    'colonnes': [..]}], 'identiques': int, 'autres_cles': [clé de payload changée hors rows]}
    """
    a, b = _lignes(avant), _lignes(apres)
    index_a = {_cle(r, i): r for i, r in enumerate(a)}
    index_b = {_cle(r, i): r for i, r in enumerate(b)}
    ajoutees = [r for k, r in index_b.items() if k not in index_a]
    supprimees = [r for k, r in index_a.items() if k not in index_b]
    modifiees, identiques = [], 0
    for k, ra in index_a.items():
        rb = index_b.get(k)
        if rb is None:
            continue
        if ra == rb:
            identiques += 1
            continue
        da, db = (ra if isinstance(ra, dict) else {}), (rb if isinstance(rb, dict) else {})
        colonnes = sorted(c for c in set(da) | set(db) if da.get(c) != db.get(c))
        modifiees.append({'avant': ra, 'apres': rb, 'colonnes': colonnes})
    cles = set((avant or {}).keys()) | set((apres or {}).keys())
    autres = sorted(c for c in cles - {'rows'} if (avant or {}).get(c) != (apres or {}).get(c))
    return {'ajoutees': ajoutees, 'supprimees': supprimees, 'modifiees': modifiees,
            'identiques': identiques, 'autres_cles': autres}


def resume(payload):
    lignes = _lignes(payload)
    return {'lignes': len(lignes)}


def _archiver(ancienne, remplacee_par=None, origine='modification'):
    from .models import PieceVersion

    dernier = PieceVersion.objects.filter(piece_id=ancienne.pk).aggregate(m=Max('numero'))['m'] or 0
    PieceVersion.objects.create(
        piece_id=ancienne.pk, numero=dernier + 1, payload=ancienne.payload or {},
        statut=ancienne.statut or '', auteur_id=ancienne.updated_by_id or ancienne.created_by_id,
        date_contenu=ancienne.updated_at, remplacee_par=remplacee_par, origine=origine,
    )
    trop = list(PieceVersion.objects.filter(piece_id=ancienne.pk)
                .order_by('-numero').values_list('pk', flat=True)[MAX_VERSIONS:])
    if trop:
        PieceVersion.objects.filter(pk__in=trop).delete()


@receiver(pre_save, sender='pieces.Piece', dispatch_uid='pieces_archiver_version')
def archiver_avant_changement(sender, instance, update_fields=None, raw=False, **kwargs):
    """Archive le contenu remplacé dès que `payload` change (jamais à la création)."""
    if raw or instance.pk is None:
        return
    if update_fields is not None and 'payload' not in update_fields:
        return
    try:
        ancienne = sender.objects.filter(pk=instance.pk).only(
            'payload', 'statut', 'updated_by', 'created_by', 'updated_at').first()
        if ancienne is None or (ancienne.payload or {}) == (instance.payload or {}):
            return
        if not _lignes(ancienne.payload) and not (ancienne.payload or {}):
            return   # rien à garder : la pièce était vide
        _archiver(ancienne,
                  remplacee_par=getattr(instance, ATTR_AUTEUR, None) or instance.updated_by,
                  origine=getattr(instance, ATTR_ORIGINE, 'modification'))
    except Exception:  # noqa: BLE001 — l'historique ne doit jamais empêcher l'écriture
        logger.exception("Archivage de la version de la pièce %s impossible", instance.pk)
