"""
File de validation : les dossiers qui attendent une décision de l'encadrement.

Avant, l'Admin Organisation devait parcourir la liste des SDGPS et repérer à l'œil les
statuts « Soumis à validation ». La file les rassemble, du plus ancien au plus récent, avec
ce qu'il faut pour décider vite : depuis combien de jours, qui l'a soumis, combien de
pièces, et le résultat du contrôle de cohérence.

Portée : celle de la décision (`workflow.est_encadrement`) — les organisations dont on est
Admin Organisation ; tout pour l'administration de l'application. Un Agent n'a pas de file.
"""
from django.utils import timezone

from accounts.permissions import is_application_admin

from .models import Ssdgps

# Onglets de la file : statut à traiter → décision attendue.
FILES = {
    Ssdgps.Statut.SOUMIS: 'à valider',
    Ssdgps.Statut.VALIDE: 'à clore',
}


def organisations_encadrees(user):
    """None = toutes (administration de l'application) ; sinon ensemble d'org_id."""
    if is_application_admin(user):
        return None
    return set(user.memberships.filter(role='ROLE_ORGANISATION_ADMIN', is_active=True)
               .values_list('organization_id', flat=True))


def dossiers_de_la_file(user, statut=Ssdgps.Statut.SOUMIS):
    orgs = organisations_encadrees(user)
    qs = (Ssdgps.objects.filter(is_deleted=False, statut=statut, affaire__is_deleted=False,
                                affaire__propriete__is_deleted=False,
                                affaire__propriete__projet__is_deleted=False)
          .select_related('affaire__propriete__projet__organization', 'statut_change_by', 'created_by')
          .order_by('statut_change_at', 'id'))
    if orgs is not None:
        qs = qs.filter(affaire__propriete__projet__organization_id__in=orgs)
    return qs


def _nom(user):
    if user is None:
        return ''
    nom = f'{user.first_name or ""} {user.last_name or ""}'.strip()
    return nom or user.email


def coherence_du_dossier(ssdgps):
    """Résumé du contrôle de cohérence sur tout le dossier ; None si le contrôle échoue."""
    try:
        from pieces.coherence import analyser_coherence
        from pieces.models import Piece
        from pieces.report import EXCLUDED_TYPES

        vivantes = (Piece.objects.filter(ssdgps=ssdgps, is_deleted=False)
                    .exclude(type_piece__in=EXCLUDED_TYPES).select_related('session')
                    .order_by('ordre', 'type_piece', 'numero'))
        valides = [p for p in vivantes if p.statut == Piece.Statut.VALIDE]
        hors = [p for p in vivantes if p.statut != Piece.Statut.VALIDE]
        sessions = list(ssdgps.sessions.filter(is_deleted=False).order_by('numero_session'))
        res = analyser_coherence(ssdgps, valides, sessions, pieces_hors_rapport=hors)
        return {'ok': res['ok'], 'erreurs': res['erreurs'], 'avertissements': res['avertissements'],
                'anomalies': [a.get('message', '') for a in res.get('anomalies', [])][:5],
                'pieces': len(vivantes)}
    except Exception:  # noqa: BLE001 — la file s'affiche même si un contrôle échoue
        return None


def element(ssdgps, maintenant=None):
    maintenant = maintenant or timezone.now()
    affaire = ssdgps.affaire
    propriete = affaire.propriete
    projet = propriete.projet
    depuis = ssdgps.statut_change_at
    return {
        'id': str(ssdgps.id), 'numero_ssdgps': ssdgps.numero_ssdgps, 'nature_ssdgps': ssdgps.nature_ssdgps,
        'type_ssdgps': ssdgps.type_ssdgps, 'statut': ssdgps.statut, 'statut_display': ssdgps.get_statut_display(),
        'projet_id': str(projet.id), 'projet_code': projet.code_projet, 'projet_nom': projet.nom_projet,
        'propriete_nom': propriete.nom_propriete, 'affaire_numero': affaire.numero_sd_affaire,
        'organisation': getattr(projet.organization, 'name', ''),
        'depuis': depuis, 'attente_jours': (maintenant - depuis).days if depuis else None,
        'par': _nom(ssdgps.statut_change_by), 'redacteur': _nom(ssdgps.created_by),
        'coherence': coherence_du_dossier(ssdgps),
    }
