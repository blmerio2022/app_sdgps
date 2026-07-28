"""Champs de sérialisation partagés liés aux utilisateurs.

`AuthorDisplayField` alimente les colonnes d'audit « Créé par » / « Modifié par » /
« Supprimé par » (cf. CLAUDE.md) : elles affichent le **nom complet** de l'auteur, et non son
email.
"""
from rest_framework import serializers


def author_display(user) -> str | None:
    """Libellé d'un auteur : nom complet, avec repli sur l'email.

    Le repli est indispensable : un compte peut n'avoir ni prénom ni nom (création rapide,
    comptes techniques) — la colonne resterait alors vide et inexploitable.
    """
    if user is None:
        return None
    full_name = (user.get_full_name() or '').strip()
    return full_name or (getattr(user, 'email', '') or '')


class AuthorDisplayField(serializers.Field):
    """Auteur d'une action, affiché par son NOM COMPLET (repli : email).

    À brancher sur la **clé étrangère** utilisateur (`source='created_by'`, `'updated_by'`,
    `'modified_by'`, `'deleted_by'`) et non sur `…​.email`. Deux avantages sur un
    `EmailField(source='created_by.email')` :

    - la valeur est le nom complet attendu par l'interface ;
    - quand la clé étrangère est nulle, le champ est rendu à `null` au lieu d'être **omis**
      du payload (`SkipField`), ce qui faisait disparaître la colonne du tableau.

    Le nom des champs exposés reste `*_by_email` : il est figé dans les allowlists
    (`TABLE_COLUMN_FIELDS`, allowlists de tri) et dans les configurations de colonnes déjà
    enregistrées par les opérateurs. Seule la VALEUR change.
    """

    def __init__(self, **kwargs):
        kwargs.setdefault('read_only', True)
        kwargs.setdefault('allow_null', True)
        super().__init__(**kwargs)

    def to_representation(self, value):
        return author_display(value)
