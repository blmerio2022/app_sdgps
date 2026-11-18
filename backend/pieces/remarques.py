"""
Remarques de validation par pièce — règles.

Cycle : `ouverte` (« à corriger ») → `corrigee` (le rédacteur) → `levee` (l'encadrement) ;
l'encadrement peut ROUVRIR une remarque corrigée ou levée.

Droits (la portée du SDGPS est vérifiée en amont par la vue) :
- écrire, lever, rouvrir : l'ENCADREMENT du dossier (`workflow.est_encadrement` : Admin
  Organisation de son organisation, ou administration de l'application) ;
- marquer corrigée : tout utilisateur ayant accès au dossier, tant qu'il n'est pas figé
  (on corrige un dossier en saisie, pas un dossier soumis) ;
- supprimer : l'auteur, tant que la remarque est ouverte.
Un dossier validé ou clos n'accepte plus de nouvelle remarque.
"""
from django.utils import timezone

from projects.workflow import est_encadrement

from .models import Piece, RemarqueValidation

LONGUEUR_MAX = 2000


class RemarqueRefusee(Exception):
    def __init__(self, message, statut=400):
        super().__init__(message)
        self.statut = statut


def _org_id(ssdgps):
    return ssdgps.affaire.propriete.projet.organization_id


def _nom(user):
    return (user.get_full_name() or user.email) if user else ''


def serialiser(r, user=None, encadrement=False):
    return {
        'id': str(r.id), 'piece': str(r.piece_id) if r.piece_id else None,
        'piece_libelle': r.piece_libelle or (r.piece.get_type_piece_display() if r.piece_id else ''),
        'ligne': r.ligne, 'texte': r.texte, 'statut': r.statut, 'statut_display': r.get_statut_display(),
        'reponse': r.reponse,
        'auteur': _nom(r.auteur), 'created_at': r.created_at,
        'corrigee_par': _nom(r.corrigee_par), 'corrigee_at': r.corrigee_at,
        'levee_par': _nom(r.levee_par), 'levee_at': r.levee_at,
        'peut_supprimer': bool(user and r.auteur_id == user.id and r.statut == RemarqueValidation.Statut.OUVERTE),
    }


def etat(ssdgps, user):
    """Liste des remarques du dossier + compteurs + droits de l'appelant."""
    encadrement = est_encadrement(user, _org_id(ssdgps))
    remarques = list(ssdgps.remarques.select_related('piece', 'auteur', 'corrigee_par', 'levee_par'))
    comptes = {s: sum(1 for r in remarques if r.statut == s) for s in RemarqueValidation.Statut.values}
    return {
        'remarques': [serialiser(r, user, encadrement) for r in remarques],
        'ouvertes': comptes['ouverte'], 'corrigees': comptes['corrigee'], 'levees': comptes['levee'],
        'peut_remarquer': encadrement and ssdgps.statut not in ('valide', 'clos'),
        'peut_lever': encadrement,
        'peut_corriger': not ssdgps.est_verrouille(),
    }


def creer(ssdgps, user, texte, piece_id=None, ligne=''):
    if not est_encadrement(user, _org_id(ssdgps)):
        raise RemarqueRefusee("Seul l'encadrement du dossier peut formuler une remarque de validation.", 403)
    if ssdgps.statut in ('valide', 'clos'):
        raise RemarqueRefusee(f"Ce SDGPS est « {ssdgps.get_statut_display()} » : plus de remarque possible.", 409)
    texte = (texte or '').strip()
    if not texte:
        raise RemarqueRefusee('La remarque est vide.')
    if len(texte) > LONGUEUR_MAX:
        raise RemarqueRefusee(f'La remarque dépasse {LONGUEUR_MAX} caractères.')
    piece = None
    if piece_id:
        piece = Piece.objects.filter(pk=piece_id, ssdgps=ssdgps, is_deleted=False).first()
        if piece is None:
            raise RemarqueRefusee('Pièce introuvable dans ce SDGPS.')
    libelle = ''
    if piece is not None:
        libelle = piece.get_type_piece_display() + (f' n°{piece.numero}' if piece.numero else '')
    return RemarqueValidation.objects.create(
        ssdgps=ssdgps, piece=piece, piece_libelle=libelle, ligne=(ligne or '').strip()[:120],
        texte=texte, auteur=user)


def corriger(r, user, reponse=''):
    if r.ssdgps.est_verrouille():
        raise RemarqueRefusee("Dossier figé : la correction se fait une fois le dossier renvoyé en saisie.", 409)
    if r.statut != RemarqueValidation.Statut.OUVERTE:
        raise RemarqueRefusee("Seule une remarque à corriger peut être marquée corrigée.")
    r.statut = RemarqueValidation.Statut.CORRIGEE
    r.reponse = (reponse or '').strip()[:LONGUEUR_MAX]
    r.corrigee_par, r.corrigee_at = user, timezone.now()
    r.save()
    return r


def _exiger_encadrement(r, user):
    if not est_encadrement(user, _org_id(r.ssdgps)):
        raise RemarqueRefusee("Réservé à l'encadrement du dossier.", 403)


def lever(r, user):
    _exiger_encadrement(r, user)
    if r.statut == RemarqueValidation.Statut.LEVEE:
        raise RemarqueRefusee('Remarque déjà levée.')
    r.statut = RemarqueValidation.Statut.LEVEE
    r.levee_par, r.levee_at = user, timezone.now()
    r.save()
    return r


def rouvrir(r, user):
    _exiger_encadrement(r, user)
    if r.statut == RemarqueValidation.Statut.OUVERTE:
        raise RemarqueRefusee('Remarque déjà ouverte.')
    r.statut = RemarqueValidation.Statut.OUVERTE
    r.levee_par = r.levee_at = None
    r.save()
    return r


def supprimer(r, user):
    if r.auteur_id != user.id or r.statut != RemarqueValidation.Statut.OUVERTE:
        raise RemarqueRefusee("Seul l'auteur peut retirer une remarque, tant qu'elle est à corriger.", 403)
    r.delete()
