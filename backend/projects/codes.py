"""
Code projet généré automatiquement : `PRJ-<année>-<n° sur 3 chiffres>`.

L'opérateur saisissait le code à la main (doublons refusés, formats hétérogènes). Le
numéro suit le plus grand déjà attribué pour l'année — projets supprimés compris, pour
qu'un code ne soit jamais réutilisé. Une course entre deux créations simultanées est
rattrapée par l'unicité en base : `creer_avec_code` réessaie avec le numéro suivant.
"""
import re

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Projet

PREFIXE = 'PRJ'
MOTIF = re.compile(rf'^{PREFIXE}-(\d{{4}})-(\d+)$')


def prochain_code(annee=None):
    annee = annee or timezone.localdate().year
    debut = f'{PREFIXE}-{annee}-'
    numeros = [int(m.group(2)) for code in Projet.objects.filter(code_projet__startswith=debut)
               .values_list('code_projet', flat=True) if (m := MOTIF.match(code))]
    return f'{debut}{(max(numeros) + 1 if numeros else 1):03d}'


def creer_avec_code(creer, essais=5):
    """Appelle `creer(code)` avec un code libre ; réessaie si un autre l'a pris entre-temps."""
    for _ in range(essais):
        code = prochain_code()
        try:
            with transaction.atomic():
                return creer(code)
        except IntegrityError:
            if not Projet.objects.filter(code_projet=code).exists():
                raise
    raise IntegrityError("Impossible d'attribuer un code projet libre.")
