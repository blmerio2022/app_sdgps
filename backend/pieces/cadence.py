"""
Cadence d'enregistrement du ROB (Rapport des observations brutes) calculée automatiquement.

La cadence est l'intervalle entre deux époques enregistrées par le récepteur : sur une
session continue de `n` époques, `durée = (n − 1) × cadence`, d'où
`cadence = durée ÷ (époques − 1)`. Le récepteur enregistre à un intervalle NOMINAL (1, 5,
15, 30 s…) ; la valeur brute est donc ramenée à l'intervalle standard le plus proche (en
échelle logarithmique) : une session de 3 h 34 min 32 s à 12 872 époques donne 1 s.

Règles (`completer_cadences`, appliqué avant chaque enregistrement d'une pièce ROB — signal
`pre_save`, donc écran, import unitaire ou en masse, ré-import, restauration) :
- cellule vide → cadence calculée ;
- cadence calculée auparavant (elle valait le calcul sur l'ANCIENNE durée / les anciennes
  époques de la même ligne) → recalculée, pour suivre une correction de la durée ou des
  époques ;
- cadence fournie par la source (fichier importé, saisie) → conservée telle quelle : elle
  reste la référence du contrôle de complétude (`controle_valeurs`, époques reçues ÷
  époques attendues), qu'une cadence déduite des époques reçues rendrait sans objet ;
- durée ou époques illisibles, ou moins de 2 époques → rien n'est calculé.
"""
import math

from django.db.models.signals import pre_save
from django.dispatch import receiver

from .tolerances import duree_secondes

# Intervalles d'enregistrement proposés par les récepteurs GNSS (secondes).
INTERVALLES = (0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300)


def _nombre(valeur):
    try:
        return float(str(valeur).replace(',', '.').replace(' ', '').replace(' ', ''))
    except (TypeError, ValueError):
        return None


def libelle(secondes: float) -> str:
    """« 1 s », « 0,5 s », « 15 s » — lu par `duree_secondes` comme les autres durées."""
    return f'{secondes:g} s'.replace('.', ',')


def cadence_calculee(ligne) -> str | None:
    """Cadence déduite de la durée et des époques d'une ligne du ROB, ou `None`."""
    if not isinstance(ligne, dict):
        return None
    duree = duree_secondes(ligne.get('duree'))
    epoques = _nombre(ligne.get('epoques'))
    if not duree or duree <= 0 or epoques is None or epoques < 2:
        return None
    brute = duree / (epoques - 1)
    proche = min(INTERVALLES, key=lambda i: abs(math.log(brute / i)))
    return libelle(proche)


def _vide(valeur) -> bool:
    return valeur is None or str(valeur).strip() in ('', '-', '--')


def _cle(ligne, index):
    if isinstance(ligne, dict) and ligne.get('id') not in (None, ''):
        return f"id:{ligne['id']}"
    return f'pos:{index}'


def completer_cadences(lignes, anciennes=None) -> int:
    """Complète (en place) la cadence des lignes du ROB ; renvoie le nombre de cellules écrites.

    `anciennes` : lignes enregistrées avant la modification, pour reconnaître une cadence
    calculée auparavant (rapprochement par `id`, sinon par position)."""
    if not isinstance(lignes, list):
        return 0
    avant = {}
    for i, l in enumerate(anciennes or []):
        avant[_cle(l, i)] = l
    ecrites = 0
    for i, ligne in enumerate(lignes):
        if not isinstance(ligne, dict):
            continue
        actuelle = ligne.get('cadence')
        if not _vide(actuelle):
            ancienne = avant.get(_cle(ligne, i))
            calcul_avant = cadence_calculee(ancienne) if ancienne else None
            # Fournie par la source (≠ calcul d'origine) : conservée.
            if calcul_avant is None or str(actuelle).strip() != calcul_avant \
                    or str((ancienne or {}).get('cadence') or '').strip() != calcul_avant:
                continue
        valeur = cadence_calculee(ligne)
        if valeur is not None and valeur != actuelle:
            ligne['cadence'] = valeur
            ecrites += 1
    return ecrites


@receiver(pre_save, sender='pieces.Piece', dispatch_uid='pieces_cadence_rob')
def _completer_avant_enregistrement(sender, instance, **kwargs):
    if instance.type_piece != 'ROB' or not isinstance(instance.payload, dict):
        return
    lignes = instance.payload.get('rows')
    if not isinstance(lignes, list) or not lignes:
        return
    anciennes = None
    if instance.pk:
        ancien = sender.objects.filter(pk=instance.pk).values_list('payload', flat=True).first()
        anciennes = (ancien or {}).get('rows') if isinstance(ancien, dict) else None
    completer_cadences(lignes, anciennes)
