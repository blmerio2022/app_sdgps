"""
Cycle de vie d'un SDGPS : en cours → soumis → validé → clos.

Un SDGPS produit une pièce officielle d'un dossier foncier. Sans état, rien ne
distinguait un dossier en saisie d'un dossier contrôlé et arrêté : les pièces d'un
dossier « terminé » restaient modifiables par n'importe qui, et aucune trace ne disait
qui l'avait contrôlé ni quand. Le rapport PDF ne le disait pas davantage.

Les règles, toutes réunies ici :

    en_cours  --soumettre-->  soumis  --valider-->  validé  --clore-->  clos
         ^                      |                      |                 |
         +------- rejeter ------+                      |                 |
         +--------------- rouvrir -----------------------+---------------+

- **soumettre** — le rédacteur (tout utilisateur ayant accès au dossier). Exige que
  TOUTES les pièces vivantes soient validées : soumettre au contrôle un dossier dont
  des pièces sont en brouillon ferait perdre son temps au valideur, et ces pièces
  seraient de toute façon absentes du rapport ;
- **valider**, **rejeter**, **clore**, **rouvrir** — réservés à l'encadrement : Admin
  Organisation ou administration de l'application. Un rédacteur qui validerait son
  propre dossier viderait le contrôle de son sens ;
- **rejeter** exige un motif : le rédacteur doit savoir quoi corriger ;
- **rouvrir** ramène un dossier validé ou clos en saisie, avec motif obligatoire : c'est
  revenir sur un contrôle déjà prononcé, cela se justifie.

Dès `soumis`, le contenu est FIGÉ (`Ssdgps.est_verrouille`) : un dossier qui bougerait
sous les yeux du valideur ne serait pas contrôlable. Le déverrouillage passe par un
rejet ou une réouverture, tous deux tracés et journalisés.
"""
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from accounts.permissions import is_application_admin


class Transition:
    """Une transition : son nom d'API, ses états de départ, son état d'arrivée."""

    def __init__(self, nom, depuis, vers, reserve_encadrement=False,
                 motif_obligatoire=False, exige_pieces_validees=False, libelle=''):
        self.nom = nom
        self.depuis = tuple(depuis)
        self.vers = vers
        self.reserve_encadrement = reserve_encadrement
        self.motif_obligatoire = motif_obligatoire
        self.exige_pieces_validees = exige_pieces_validees
        self.libelle = libelle


TRANSITIONS = {
    t.nom: t for t in [
        Transition('soumettre', ['en_cours'], 'soumis', exige_pieces_validees=True,
                   libelle="Soumettre à validation"),
        Transition('valider', ['soumis'], 'valide', reserve_encadrement=True,
                   libelle="Valider le dossier"),
        Transition('rejeter', ['soumis'], 'en_cours', reserve_encadrement=True,
                   motif_obligatoire=True, libelle="Rejeter et renvoyer en saisie"),
        Transition('clore', ['valide'], 'clos', reserve_encadrement=True,
                   libelle="Clore le dossier"),
        Transition('rouvrir', ['valide', 'clos'], 'en_cours', reserve_encadrement=True,
                   motif_obligatoire=True, libelle="Rouvrir en saisie"),
    ]
}


def est_encadrement(user, organization_id):
    """Vrai pour qui peut prononcer une validation : Admin Organisation de CETTE
    organisation, ou administration de l'application.

    Un Agent Organisation en est exclu, même sur son propre dossier : un rédacteur qui
    validerait sa propre production viderait le contrôle de son sens.
    """
    if is_application_admin(user):
        return True
    if not (user and user.is_authenticated):
        return False
    return user.memberships.filter(
        organization_id=organization_id, role='ROLE_ORGANISATION_ADMIN', is_active=True,
    ).exists()


def transitions_possibles(ssdgps, user, organization_id):
    """Noms des transitions que `user` peut réellement déclencher sur ce dossier.

    Sert au front à n'afficher que les boutons utiles — garde **cosmétique** : la
    décision reste prise ici, à chaque appel d'`appliquer_transition`.
    """
    encadrement = est_encadrement(user, organization_id)
    return [nom for nom, t in TRANSITIONS.items()
            if ssdgps.statut in t.depuis and (encadrement or not t.reserve_encadrement)]


def pieces_non_validees(ssdgps):
    """Pièces vivantes qui ne sont pas validées — ce qui empêche la soumission."""
    from pieces.models import Piece

    return list(Piece.objects.filter(ssdgps=ssdgps, is_deleted=False)
                .exclude(statut=Piece.Statut.VALIDE)
                .order_by('ordre', 'type_piece', 'numero'))


def appliquer_transition(ssdgps, nom, user, organization_id, motif=''):
    """Applique la transition `nom` et enregistre qui l'a prononcée, quand et pourquoi.

    Lève `ValidationError` (règle métier non satisfaite) ou `PermissionDenied` (rôle
    insuffisant). Ne journalise pas : c'est l'affaire de la vue, qui dispose de la
    requête (IP, acteur) — cf. `accounts/audit.py`.
    """
    transition = TRANSITIONS.get(nom)
    if transition is None:
        raise ValidationError(f"Transition inconnue : « {nom} ».")

    if ssdgps.statut not in transition.depuis:
        attendus = ', '.join(f"« {s} »" for s in transition.depuis)
        raise ValidationError(
            f"« {transition.libelle} » n'est possible que depuis {attendus} ; "
            f"ce dossier est « {ssdgps.get_statut_display()} ».")

    if transition.reserve_encadrement and not est_encadrement(user, organization_id):
        raise PermissionDenied(
            "Cette décision est réservée à l'Admin Organisation et à l'administration "
            "de l'application.")

    motif = (motif or '').strip()
    if transition.motif_obligatoire and not motif:
        raise ValidationError(
            "Un motif est obligatoire : le rédacteur doit savoir quoi corriger.")

    if transition.exige_pieces_validees:
        restantes = pieces_non_validees(ssdgps)
        if not restantes:
            from pieces.models import Piece

            if not Piece.objects.filter(ssdgps=ssdgps, is_deleted=False,
                                        statut=Piece.Statut.VALIDE).exists():
                raise ValidationError(
                    "Ce dossier ne contient aucune pièce : il n'y a rien à valider.")
        else:
            details = ', '.join(
                f"{p.get_type_piece_display()}"
                + (f" n°{p.numero}" if p.numero else '')
                + f" ({p.get_statut_display()})"
                for p in restantes[:5])
            suite = f" et {len(restantes) - 5} autre(s)" if len(restantes) > 5 else ''
            raise ValidationError(
                f"{len(restantes)} pièce(s) ne sont pas validées : {details}{suite}. "
                "Elles seraient absentes du rapport.")

    ancien = ssdgps.statut
    ssdgps.statut = transition.vers
    ssdgps.statut_change_at = timezone.now()
    ssdgps.statut_change_by = user if (user and user.is_authenticated) else None
    ssdgps.motif_statut = motif
    ssdgps.save(update_fields=['statut', 'statut_change_at', 'statut_change_by',
                               'motif_statut', 'updated_at'])
    return ancien, transition.vers
