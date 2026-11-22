"""
Règles de validation métier partagées entre les modèles (`Model.clean()`) et les
sérialiseurs DRF (`Serializer.validate()`), afin d'éviter toute duplication.
"""
import re
from django.core.exceptions import ValidationError

# --- Formats d'identifiants de propriété -----------------------------------
# Indice : soit un numéro d'ordre (1–1000, borne large tolérée), soit 1 à 2 lettres majuscules.
_INDICE = r'(?:\d{1,4}|[A-Z]{1,2})'
# La lettre de tête (R pour une réquisition, T pour un titre) est FACULTATIVE : les deux
# écritures circulent dans les dossiers (« R19000/55 » comme « 19000/55 »).
REQUISITION_RE = re.compile(rf'^R?\d{{1,6}}/{_INDICE}$')
TITRE_RE = re.compile(rf'^T?\d{{1,6}}/{_INDICE}$')
MESSAGE_REQUISITION = ("Format de réquisition invalide. Attendu : [R]<numéro>/<indice> "
                       "(ex. R19000/55, 19000/55 ou R19000/AB).")
MESSAGE_TITRE = ("Format de titre invalide. Attendu : [T]<numéro>/<indice> "
                 "(ex. T12345/A ou 12345/A).")


def normaliser_identifiant(value):
    """Écriture canonique d'une saisie : espaces retirés, lettres en majuscules
    (« r 19000/ab » → « R19000/AB »). La lettre de tête n'est ni ajoutée ni retirée."""
    return re.sub(r'\s+', '', str(value or '')).upper()


def validate_requisition_format(value):
    if value and not REQUISITION_RE.match(value):
        raise ValidationError(MESSAGE_REQUISITION)


def validate_titre_format(value):
    if value and not TITRE_RE.match(value):
        raise ValidationError(MESSAGE_TITRE)


# --- Procédures / natures d'affaire -----------------------------------------
# Natures d'affaire autorisées selon la nature de procédure.
PROCEDURE_NATURES = {
    'IFF': ['BI', 'BC'],
    'IFE': ['IFE'],
    'IFR': ['IFR'],
    'PS_FORET': ['RB'],
    'PS_COLLECTIF': ['RB'],
    'PS_EXPROPRIATION': ['RB'],
    'AS': ['MEC', 'MT', 'FS', 'MT-FS', 'LOT', 'COP'],
}

# Procédures pour lesquelles date_bornage n'est pas définie (doit rester nulle).
PROCEDURES_SANS_DATE_BORNAGE = {'IFE', 'IFR'}


def validate_affaire_coherence(nature_procedure, nature_affaire, date_bornage):
    """
    Vérifie la cohérence procédure ↔ nature d'affaire ↔ date de bornage.
    Lève une ValidationError (avec dict de champs) en cas d'incohérence.
    """
    errors = {}

    allowed = PROCEDURE_NATURES.get(nature_procedure)
    if allowed is None:
        errors['nature_procedure_affaire'] = "Nature de procédure inconnue."
    elif nature_affaire not in allowed:
        errors['nature_affaire'] = (
            f"Nature d'affaire « {nature_affaire} » invalide pour la procédure "
            f"« {nature_procedure} ». Valeurs autorisées : {', '.join(allowed)}."
        )

    if nature_procedure in PROCEDURES_SANS_DATE_BORNAGE:
        if date_bornage is not None:
            errors['date_bornage'] = (
                "La date de bornage n'est pas définie pour les procédures IFE/IFR."
            )
    else:
        # IFF, AS, PS_* : la date (bornage ou recollement) est requise.
        if date_bornage is None:
            errors['date_bornage'] = (
                "La date de bornage/recollement est requise pour cette procédure."
            )

    if errors:
        raise ValidationError(errors)
