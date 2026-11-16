"""
Tableau de bord d'activité : ce que produisent les équipes, et à quel rythme.

Les données existaient déjà (statuts des SDGPS, journal d'audit) ; il manquait la vue.
Indicateurs sur une période (par défaut les 12 derniers mois) :
- par mois : dossiers créés, soumis, validés, rejetés, clos ; rapports générés ;
- délai moyen de validation (de la soumission à la validation, par dossier) ;
- taux de rejet = rejets / (validations + rejets) ;
- par opérateur : dossiers créés, soumissions, rejets reçus, rapports générés,
  appels à l'IA et jetons consommés.

Portée : l'administration de l'application voit tout (filtre `organisation` possible) ;
un Admin Organisation, ses organisations ; un Agent n'y a pas accès.
"""
from collections import defaultdict
from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db.models.functions import TruncMonth
from django.db.models import Count
from django.utils import timezone

from accounts.models import AuditEvent
from accounts.permissions import is_application_admin
from projects.models import Ssdgps

MESURES = ['crees', 'soumis', 'valides', 'rejetes', 'clos', 'rapports']
TRANSITION_MESURE = {'soumettre': 'soumis', 'valider': 'valides', 'rejeter': 'rejetes', 'clore': 'clos'}


def organisations_visibles(user):
    """None = toutes ; ensemble vide = aucun accès."""
    if is_application_admin(user):
        return None
    return set(user.memberships.filter(role='ROLE_ORGANISATION_ADMIN', is_active=True)
               .values_list('organization_id', flat=True))


def _mois(d):
    return d.strftime('%Y-%m')


def _liste_mois(debut, fin):
    mois, d = [], debut.replace(day=1)
    while d <= fin:
        mois.append(d.strftime('%Y-%m'))
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return mois


def _nom(u):
    nom = f'{u.first_name or ""} {u.last_name or ""}'.strip()
    return nom or u.email


def calculer(user, depuis=None, jusqu_a=None, organisation=None):
    orgs = organisations_visibles(user)
    if organisation:
        # Restreindre à une organisation, sans jamais élargir la portée de l'appelant.
        orgs = {organisation} if orgs is None else {o for o in orgs if str(o) == str(organisation)}

    fin = jusqu_a or timezone.localdate()
    debut = depuis or (fin.replace(day=1) - timedelta(days=335)).replace(day=1)
    tz = timezone.get_current_timezone()
    t0 = timezone.make_aware(datetime.combine(debut, time.min), tz)
    t1 = timezone.make_aware(datetime.combine(fin, time.max), tz)

    ssdgps = Ssdgps.objects.filter(is_deleted=False)
    if orgs is not None:
        ssdgps = ssdgps.filter(affaire__propriete__projet__organization_id__in=orgs)
    ids_ssdgps = set(str(i) for i in ssdgps.values_list('id', flat=True))

    par_mois = {m: {k: 0 for k in MESURES} for m in _liste_mois(debut, fin)}
    operateurs = defaultdict(lambda: {'crees': 0, 'soumissions': 0, 'rejets_recus': 0, 'rapports': 0,
                                      'appels_ia': 0, 'jetons_ia': 0})

    for ligne in (ssdgps.filter(created_at__range=(t0, t1)).annotate(m=TruncMonth('created_at'))
                  .values('m', 'created_by').annotate(n=Count('id'))):
        m = _mois(ligne['m'])
        if m in par_mois:
            par_mois[m]['crees'] += ligne['n']
        if ligne['created_by']:
            operateurs[ligne['created_by']]['crees'] += ligne['n']

    evenements = AuditEvent.objects.filter(created_at__range=(t0, t1), action__in=[
        AuditEvent.ACTION_SSDGPS_STATUT, AuditEvent.ACTION_RAPPORT_GENERE]).order_by('created_at')
    if orgs is not None:
        evenements = evenements.filter(cible_id__in=ids_ssdgps)
    soumissions = {}          # ssdgps → date de la dernière soumission
    delais, nb_valides, nb_rejets = [], 0, 0
    createur = dict((str(k), v) for k, v in ssdgps.values_list('id', 'created_by'))
    for ev in evenements:
        m = _mois(timezone.localtime(ev.created_at))
        if ev.action == AuditEvent.ACTION_RAPPORT_GENERE:
            if m in par_mois:
                par_mois[m]['rapports'] += 1
            if ev.acteur_id:
                operateurs[ev.acteur_id]['rapports'] += 1
            continue
        transition = (ev.details or {}).get('transition')
        mesure = TRANSITION_MESURE.get(transition)
        if mesure and m in par_mois:
            par_mois[m][mesure] += 1
        if transition == 'soumettre':
            soumissions[ev.cible_id] = ev.created_at
            if ev.acteur_id:
                operateurs[ev.acteur_id]['soumissions'] += 1
        elif transition == 'valider':
            nb_valides += 1
            if ev.cible_id in soumissions:
                delais.append((ev.created_at - soumissions.pop(ev.cible_id)).total_seconds())
        elif transition == 'rejeter':
            nb_rejets += 1
            soumissions.pop(ev.cible_id, None)
            auteur = createur.get(ev.cible_id)
            if auteur:
                operateurs[auteur]['rejets_recus'] += 1

    # Appels à l'IA : ceux des opérateurs visibles (membres des organisations encadrées).
    User = get_user_model()
    ia = AuditEvent.objects.filter(created_at__range=(t0, t1), action=AuditEvent.ACTION_IA_APPEL)
    if orgs is not None:
        membres = User.objects.filter(memberships__organization_id__in=orgs).values_list('id', flat=True)
        ia = ia.filter(acteur_id__in=list(membres))
    for ev in ia.only('acteur_id', 'details'):
        if ev.acteur_id:
            d = ev.details or {}
            operateurs[ev.acteur_id]['appels_ia'] += 1
            operateurs[ev.acteur_id]['jetons_ia'] += (d.get('jetons_entree') or 0) + (d.get('jetons_sortie') or 0)

    noms = {u.id: (_nom(u), u.email) for u in User.objects.filter(id__in=list(operateurs))}
    lignes_op = sorted(({'id': uid, 'nom': noms.get(uid, ('—', ''))[0], 'email': noms.get(uid, ('', ''))[1], **v}
                        for uid, v in operateurs.items()), key=lambda r: (-r['crees'], -r['soumissions'], r['nom']))
    totaux = {k: sum(v[k] for v in par_mois.values()) for k in MESURES}
    decisions = nb_valides + nb_rejets
    return {
        'periode': {'depuis': debut.isoformat(), 'jusqu_a': fin.isoformat()},
        'totaux': totaux,
        'delai_validation_jours': round(sum(delais) / len(delais) / 86400, 1) if delais else None,
        'taux_rejet': round(nb_rejets / decisions, 3) if decisions else None,
        'en_attente': ssdgps.filter(statut=Ssdgps.Statut.SOUMIS).count(),
        'par_mois': [{'mois': m, **v} for m, v in par_mois.items()],
        'operateurs': lignes_op,
    }
