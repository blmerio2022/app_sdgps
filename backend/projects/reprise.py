"""
« Reprendre mon travail » — les travaux que l'utilisateur a commencés et pas terminés,
du plus récent au plus ancien, pour le tableau de bord d'accueil.

Ce qui compte comme un travail en cours (toujours filtré par `scope_queryset`, corbeille
et parents en corbeille exclus) :

- **SDGPS** au statut `en_cours` (soumis / validé / clos = terminé pour l'opérateur) que
  l'utilisateur a touché : le dossier lui-même, l'une de ses sessions ou l'une de ses
  pièces (créée ou modifiée). La date retenue est celle de SA dernière intervention, pas
  celle d'un collègue. Le dossier porte sa progression (pièces validées / total), la
  dernière pièce touchée (lien direct), la session concernée en multi-session et, s'il a
  été renvoyé en saisie, le motif ;
- **rapport** en cours de génération (en attente / en cours), ou en échec depuis moins de
  `ECHEC_JOURS` jours sans génération réussie depuis sur le même dossier ;
- **niveau incomplet** créé ou modifié par l'utilisateur : projet sans propriété (hors
  projets clôturés / archivés), propriété sans affaire, affaire sans SDGPS.

Chaque entrée porte un `lien` RELATIF que le front préfixe (`/admin/` selon la zone).
"""
from datetime import timedelta

from django.db.models import Count, Max, Q
from django.utils import timezone

from pieces.models import Piece, RapportGeneration

from .models import Affaire, Projet, Propriete, Session, Ssdgps

LIMITE_DEFAUT = 12
ECHEC_JOURS = 7


def _par_moi(user, prefixe=''):
    return Q(**{f'{prefixe}created_by': user}) | Q(**{f'{prefixe}updated_by': user})


def _vivants_ssdgps():
    return Ssdgps.objects.filter(is_deleted=False, affaire__is_deleted=False,
                                 affaire__propriete__is_deleted=False,
                                 affaire__propriete__projet__is_deleted=False)


def _contexte(ss):
    a = ss.affaire
    p = a.propriete
    return ' · '.join(x for x in [p.projet.code_projet, p.nom_propriete, f'SD {a.numero_sd_affaire}'] if x)


def _lien_pieces(ss, session=None, extra=''):
    a = ss.affaire
    q = f'?proprieteId={a.propriete_id}&affaireId={a.id}'
    if session is not None:
        q += f'&session={session.id}'
    return f'projets/{a.propriete.projet_id}/pieces/{ss.id}{q}{extra}'


def _ssdgps(user):
    from .views import scope_queryset

    mes_pieces = Piece.objects.filter(_par_moi(user), is_deleted=False)
    act_pieces = dict(mes_pieces.values('ssdgps_id').annotate(m=Max('updated_at'))
                      .values_list('ssdgps_id', 'm'))
    act_sessions = dict(Session.objects.filter(_par_moi(user), is_deleted=False)
                        .values('ssdgps_id').annotate(m=Max('updated_at'))
                        .values_list('ssdgps_id', 'm'))

    qs = _vivants_ssdgps().filter(statut=Ssdgps.Statut.EN_COURS).filter(
        _par_moi(user) | Q(id__in=list(act_pieces)) | Q(id__in=list(act_sessions)))
    qs = scope_queryset(qs, user, 'affaire__propriete__projet__organization_id')
    dossiers = list(qs.select_related('affaire__propriete__projet'))
    if not dossiers:
        return []
    ids = [s.id for s in dossiers]

    comptes = {c['ssdgps_id']: c for c in Piece.objects.filter(ssdgps_id__in=ids, is_deleted=False)
               .values('ssdgps_id').annotate(total=Count('id'),
                                             validees=Count('id', filter=Q(statut=Piece.Statut.VALIDE)))}
    # Dernière pièce touchée par l'utilisateur, par dossier.
    dernieres = {}
    for p in mes_pieces.filter(ssdgps_id__in=ids).select_related('session').order_by('-updated_at'):
        dernieres.setdefault(p.ssdgps_id, p)
        if len(dernieres) == len(ids):
            break
    sessions_recentes = {}
    for s in Session.objects.filter(_par_moi(user), is_deleted=False, ssdgps_id__in=ids).order_by('-updated_at'):
        sessions_recentes.setdefault(s.ssdgps_id, s)

    out = []
    for ss in dossiers:
        dates = [act_pieces.get(ss.id), act_sessions.get(ss.id)]
        if ss.created_by_id == user.id or ss.updated_by_id == user.id:
            dates.append(ss.updated_at)
        date = max(d for d in dates if d is not None)

        derniere = dernieres.get(ss.id)
        multi = ss.type_ssdgps == 'multi-session'
        session = None
        if multi:
            session = (derniere.session if derniere and derniere.session_id
                       else sessions_recentes.get(ss.id))
        c = comptes.get(ss.id, {'total': 0, 'validees': 0})
        projet_id = ss.affaire.propriete.projet_id
        # Prochaine étape, dite en clair : c'est ce qui fait d'une ligne un travail à reprendre.
        if ss.motif_statut:
            a_faire = 'Corriger selon le motif du renvoi'
        elif c['total'] == 0:
            a_faire = 'Ajouter les pièces'
        elif c['validees'] < c['total']:
            reste = c['total'] - c['validees']
            a_faire = f'{reste} pièce{"s" if reste > 1 else ""} à valider'
        else:
            a_faire = 'Prêt à soumettre à validation'
        out.append({
            'type': 'ssdgps', 'id': str(ss.id), 'date': date,
            'titre': f'SDGPS n°{ss.numero_ssdgps} — {ss.nature_ssdgps}',
            'contexte': _contexte(ss),
            'statut': ss.statut, 'statut_display': ss.get_statut_display(),
            'renvoye': bool(ss.motif_statut), 'motif': ss.motif_statut or '',
            'progression': {'validees': c['validees'], 'total': c['total']},
            'a_faire': a_faire,
            'session': ({'numero': session.numero_session} if session else None),
            'derniere_piece': ({
                'type_piece': derniere.type_piece,
                'libelle': derniere.get_type_piece_display() + (f' n°{derniere.numero}' if derniere.numero else ''),
                'statut': derniere.statut, 'statut_display': derniere.get_statut_display(),
                'lien': f'projets/{projet_id}/pieces/{ss.id}/piece/{derniere.id}',
            } if derniere else None),
            'lien': _lien_pieces(ss, session),
        })
    return out


def _rapports(user):
    from .views import scope_queryset

    maintenant = timezone.now()
    qs = RapportGeneration.objects.filter(created_by=user).filter(
        Q(statut__in=[RapportGeneration.Statut.EN_ATTENTE, RapportGeneration.Statut.EN_COURS])
        | Q(statut=RapportGeneration.Statut.ECHEC, created_at__gte=maintenant - timedelta(days=ECHEC_JOURS)))
    qs = qs.filter(ssdgps__is_deleted=False, ssdgps__affaire__is_deleted=False,
                   ssdgps__affaire__propriete__is_deleted=False,
                   ssdgps__affaire__propriete__projet__is_deleted=False)
    qs = scope_queryset(qs, user, 'ssdgps__affaire__propriete__projet__organization_id')
    out, vus = [], set()
    for g in qs.select_related('ssdgps__affaire__propriete__projet', 'session').order_by('-created_at'):
        if g.ssdgps_id in vus:
            continue                                  # la génération la plus récente suffit
        vus.add(g.ssdgps_id)
        if g.statut == RapportGeneration.Statut.ECHEC and RapportGeneration.objects.filter(
                ssdgps_id=g.ssdgps_id, created_by=user, statut=RapportGeneration.Statut.TERMINE,
                created_at__gt=g.created_at).exists():
            continue                                  # échec déjà rattrapé par une génération réussie
        ss = g.ssdgps
        out.append({
            'type': 'rapport', 'id': str(g.id), 'date': g.started_at or g.created_at,
            'titre': f'Rapport du SDGPS n°{ss.numero_ssdgps} — {ss.nature_ssdgps}',
            'contexte': _contexte(ss),
            'statut': g.statut, 'statut_display': g.get_statut_display(),
            'progression_pct': g.progression, 'etape': g.etape, 'erreur': (g.erreur or '')[:200],
            'a_faire': ('Relancer la génération' if g.statut == RapportGeneration.Statut.ECHEC
                        else 'Suivre la génération'),
            'lien': _lien_pieces(ss, g.session, '&rapport=1'),
        })
    return out


def _niveaux_incomplets(user):
    from .views import scope_queryset
    out = []

    projets = scope_queryset(
        Projet.objects.filter(_par_moi(user), is_deleted=False)
        .exclude(statut__in=[Projet.Statut.CLOTURE, Projet.Statut.ARCHIVE])
        .annotate(n=Count('proprietes', filter=Q(proprietes__is_deleted=False))).filter(n=0),
        user, 'organization_id')
    for p in projets:
        out.append({'type': 'projet', 'id': str(p.id), 'date': p.updated_at,
                    'titre': f'{p.code_projet} — {p.nom_projet}', 'contexte': 'Projet',
                    'a_faire': 'Ajouter une propriété', 'lien': f'projets/{p.id}'})

    proprietes = scope_queryset(
        Propriete.objects.filter(_par_moi(user), is_deleted=False, projet__is_deleted=False)
        .annotate(n=Count('affaires', filter=Q(affaires__is_deleted=False))).filter(n=0),
        user, 'projet__organization_id').select_related('projet')
    for p in proprietes:
        out.append({'type': 'propriete', 'id': str(p.id), 'date': p.updated_at,
                    'titre': p.nom_propriete, 'contexte': p.projet.code_projet,
                    'a_faire': 'Ajouter une affaire',
                    'lien': f'projets/{p.projet_id}?proprieteId={p.id}'})

    affaires = scope_queryset(
        Affaire.objects.filter(_par_moi(user), is_deleted=False, propriete__is_deleted=False,
                               propriete__projet__is_deleted=False)
        .annotate(n=Count('ssdgps_set', filter=Q(ssdgps_set__is_deleted=False))).filter(n=0),
        user, 'propriete__projet__organization_id').select_related('propriete__projet')
    for a in affaires:
        out.append({'type': 'affaire', 'id': str(a.id), 'date': a.updated_at,
                    'titre': f'SD {a.numero_sd_affaire} — {a.nature_affaire}',
                    'contexte': f'{a.propriete.projet.code_projet} · {a.propriete.nom_propriete}',
                    'a_faire': 'Créer le SDGPS',
                    'lien': f'projets/{a.propriete.projet_id}?proprieteId={a.propriete_id}&affaireId={a.id}'})
    return out


def travaux_a_reprendre(user, limite=LIMITE_DEFAUT) -> dict:
    """Travaux en cours de l'utilisateur, du plus récent au plus ancien."""
    tous = _ssdgps(user) + _rapports(user) + _niveaux_incomplets(user)
    tous.sort(key=lambda t: t['date'], reverse=True)
    return {'total': len(tous), 'resultats': tous[:max(1, limite)]}
