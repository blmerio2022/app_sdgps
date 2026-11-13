"""
Assistant de création d'un SDGPS — création ATOMIQUE de toute la chaîne.

Sans l'assistant, créer un dossier exige de traverser quatre listes (projet, propriété,
affaire, SDGPS) avant même la première pièce. L'assistant les réunit en un seul
formulaire ; ce module en est le pendant serveur : il reçoit la chaîne complète, crée ce
qui doit l'être, réutilise ce qui existe, et n'écrit RIEN si un seul maillon est invalide
(transaction) — un échec en fin de parcours ne laisse ni projet ni propriété orphelins.

Chaque niveau accepte soit `{"id": "<uuid>"}` (élément existant), soit
`{"nouveau": {...}}` (champs du sérialiseur du niveau, sans la clé du parent, posée ici).
Les contrôles sont ceux des vues CRUD : mêmes sérialiseurs, même portée RBAC.
"""
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from .models import Projet, Propriete, Affaire, Ssdgps, Session, ModeleSsdgps
from .serializers import (
    ProjetSerializer, ProprieteSerializer, AffaireSerializer, SsdgpsSerializer,
)

NB_SESSIONS_MAX = 50


def _erreur(niveau, detail):
    """Erreurs rangées sous la clé du niveau fautif : le front sait quelle étape rouvrir."""
    return serializers.ValidationError({niveau: detail})


def modeles_visibles(user):
    """Modèles qu'un utilisateur peut employer : ceux de l'application + les siens."""
    from django.db.models import Q
    return ModeleSsdgps.objects.filter(is_deleted=False).filter(
        Q(portee=ModeleSsdgps.Portee.SYSTEME) | Q(proprietaire=user))


def _bloc(data, niveau):
    bloc = data.get(niveau)
    if not isinstance(bloc, dict) or not (bloc.get('id') or isinstance(bloc.get('nouveau'), dict)):
        raise _erreur(niveau, "Choisissez un élément existant ou décrivez-en un nouveau.")
    return bloc


def _verifier_portee_projet(user, projet):
    from .views import is_scope_visible
    if not is_scope_visible(user, projet.organization_id, projet.created_by_id):
        raise PermissionDenied(
            "Vous ne pouvez créer un dossier que dans votre organisation "
            "ou dans un projet que vous avez créé.")


def _creer(serializer_class, niveau, donnees, context, **save_kwargs):
    ser = serializer_class(data=donnees, context=context)
    if not ser.is_valid():
        raise _erreur(niveau, ser.errors)
    return ser.save(**save_kwargs)


def _projet(user, bloc, context):
    from .views import scope_queryset, user_org_ids
    if bloc.get('id'):
        projet = scope_queryset(Projet.objects.filter(is_deleted=False), user,
                                'organization_id').filter(pk=bloc['id']).first()
        if projet is None:
            raise _erreur('projet', "Projet introuvable ou inaccessible.")
        return projet, False
    donnees = dict(bloc['nouveau'])
    # Même règle que ProjetViewSet.perform_create : un projet appartient à l'organisation
    # courante de son créateur ; seuls les administrateurs sans organisation choisissent.
    org = user.get_primary_organization()
    if org is not None:
        donnees['organization'] = org.pk
    ser = ProjetSerializer(data=donnees, context=context)
    if not ser.is_valid():
        raise _erreur('projet', ser.errors)
    ids = user_org_ids(user)
    if ids is not None and ser.validated_data['organization'].id not in ids:
        raise PermissionDenied("Vous ne pouvez créer un projet que dans votre organisation.")
    return ser.save(created_by=user), True


def _enfant(model, parent_field, parent, niveau, bloc, serializer_class, user, context):
    if bloc.get('id'):
        objet = model.objects.filter(
            pk=bloc['id'], is_deleted=False, **{parent_field: parent}).first()
        if objet is None:
            raise _erreur(niveau, "Élément introuvable dans le parent choisi.")
        return objet, False
    donnees = {**bloc['nouveau'], parent_field: parent.pk}
    return _creer(serializer_class, niveau, donnees, context, created_by=user), True


@transaction.atomic
def creer_dossier(user, data, request=None):
    """Crée (ou réutilise) projet, propriété, affaire, puis crée le SDGPS rattaché au
    modèle choisi. Renvoie `(ssdgps, crees)` où `crees` liste les niveaux créés."""
    context = {'request': request}

    # Le modèle d'abord : il ne coûte rien à contrôler et conditionne la nature.
    modele = None
    if data.get('modele'):
        modele = modeles_visibles(user).filter(pk=data['modele']).first()
        if modele is None:
            raise _erreur('modele', "Modèle introuvable ou inaccessible.")

    projet, projet_cree = _projet(user, _bloc(data, 'projet'), context)
    _verifier_portee_projet(user, projet)
    propriete, prop_creee = _enfant(Propriete, 'projet', projet, 'propriete',
                                    _bloc(data, 'propriete'), ProprieteSerializer, user, context)
    affaire, aff_creee = _enfant(Affaire, 'propriete', propriete, 'affaire',
                                 _bloc(data, 'affaire'), AffaireSerializer, user, context)

    donnees_ssdgps = dict(data.get('ssdgps') or {})
    if modele is not None:
        donnees_ssdgps.setdefault('nature_ssdgps', modele.nature_ssdgps)
        if donnees_ssdgps['nature_ssdgps'] != modele.nature_ssdgps:
            raise _erreur('modele', (
                f"Le modèle « {modele.nom} » est prévu pour la nature "
                f"{modele.nature_ssdgps}, pas {donnees_ssdgps['nature_ssdgps']}."))
    if not donnees_ssdgps.get('numero_ssdgps'):
        dernier = affaire.ssdgps_set.order_by('-numero_ssdgps').values_list(
            'numero_ssdgps', flat=True).first()
        donnees_ssdgps['numero_ssdgps'] = (dernier or 0) + 1
    donnees_ssdgps['affaire'] = affaire.pk
    ssdgps = _creer(SsdgpsSerializer, 'ssdgps', donnees_ssdgps, context, created_by=user,
                    modele=modele, pieces_prevues=list(modele.pieces) if modele else [])

    # Multi-session : les sessions sont créées d'emblée (le mono-session reçoit la sienne
    # du signal `autocreate_mono_session`).
    if ssdgps.type_ssdgps == Ssdgps.TypeSSDGPS.MULTI:
        try:
            brut = data.get('nb_sessions')
            nb = 1 if brut in (None, '') else int(brut)
        except (TypeError, ValueError):
            raise _erreur('nb_sessions', "Nombre de sessions invalide.")
        if not 1 <= nb <= NB_SESSIONS_MAX:
            raise _erreur('nb_sessions', f"Entre 1 et {NB_SESSIONS_MAX} sessions.")
        for numero in range(1, nb + 1):
            Session.objects.get_or_create(
                ssdgps=ssdgps, numero_session=numero, defaults={'created_by': user})

    crees = [n for n, c in (('projet', projet_cree), ('propriete', prop_creee),
                            ('affaire', aff_creee)) if c] + ['ssdgps']
    return ssdgps, crees
