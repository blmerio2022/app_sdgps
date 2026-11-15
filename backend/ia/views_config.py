"""
Configuration de l'IA dans l'application — `/api/v1/ia/config/`, `modeles/`, `preferences/`.

- `GET  config/`               — état effectif (tous les utilisateurs connectés) ; la clé
                                 n'est JAMAIS renvoyée, seulement sa présence et sa fin ;
- `PUT  config/`               — modification (administration de l'application) ;
- `POST config/reinitialiser/` — retour aux variables d'environnement (idem) ;
- `POST config/tester/`        — essai de connexion avec la configuration effective (idem) ;
- `GET  modeles/?filtre=`      — modèles accessibles chez le fournisseur (tous) ;
- `GET|PUT preferences/`       — modèle préféré de l'utilisateur pour SON assistant.

Une configuration saisie ici prime sur l'environnement dès qu'elle désigne un
fournisseur ou une adresse (cf. `client._en_base`) ; chaque modification est
journalisée (`ACTION_IA_CONFIG`) sans jamais y inscrire la clé.
"""
import hashlib
import time
from urllib.parse import urlparse

from django.core.cache import cache
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsApplicationAdmin, is_application_admin

from . import client, fournisseurs, openai_compat
from .models import ConfigurationIa, PreferenceIa
from .secret import chiffrer, dechiffrer, indice

PROTOCOLES = ('', 'anthropic', 'openai')


def _origine_cle():
    cfg = client._en_base()
    if cfg and dechiffrer(cfg.cle_chiffree):
        return 'application'
    return 'environnement' if client.cle() else None


def etat(utilisateur):
    """Configuration effective + valeurs saisies, pour l'écran Paramètres."""
    cfg = ConfigurationIa.objects.filter(pk=1).first()
    f = client.fournisseur()
    cle = client.cle()
    illisible = bool(cfg and cfg.cle_chiffree and not dechiffrer(cfg.cle_chiffree))
    return {
        'modifiable': is_application_admin(utilisateur),
        'source': client.source(),
        'saisie': {
            'actif': cfg.actif if cfg else None,
            'fournisseur': cfg.fournisseur if cfg else '',
            'base_url': cfg.base_url if cfg else '',
            'protocole': cfg.protocole if cfg else '',
            'modele': cfg.modele if cfg else '',
            'modeles_secours': client._decouper(cfg.modeles_secours) if cfg else [],
            'delai': cfg.delai if cfg else None,
            'cle_enregistree': bool(cfg and cfg.cle_chiffree),
            'cle_indice': (cfg.cle_indice if cfg else ''),
            'cle_illisible': illisible,
        },
        'effectif': {
            'disponible': client.disponible(),
            'actif': client.actif(),
            'fournisseur': f.cle if f else '',
            'fournisseur_libelle': f.libelle if f else 'API Anthropic / adresse libre',
            'protocole': client.protocole(),
            'adresse': client.adresse() or 'API Anthropic directe',
            'modele': client.modele(),
            'modeles_essai': client.modeles_essai(),
            'cle_presente': bool(cle),
            'cle_indice': indice(cle),
            'cle_origine': _origine_cle(),
            'delai': client.delai(),
        },
        'catalogue': [
            {'cle': x.cle, 'libelle': x.libelle, 'protocole': x.protocole, 'base_url': x.base_url,
             'modele': x.modele, 'gratuit': x.gratuit, 'obtenir_cle': x.obtenir_cle}
            for x in fournisseurs.FOURNISSEURS.values()
        ],
        'modifie_le': cfg.updated_at if cfg else None,
        'modifie_par': (cfg.updated_by.get_full_name() or cfg.updated_by.email)
        if cfg and cfg.updated_by else None,
    }


def _valider(donnees):
    """Valide les champs reçus ; renvoie `(champs, erreurs)`."""
    champs, erreurs = {}, {}
    if 'actif' in donnees:
        v = donnees['actif']
        if v not in (None, True, False):
            erreurs['actif'] = 'Valeur attendue : vrai, faux ou vide.'
        champs['actif'] = v
    if 'fournisseur' in donnees:
        v = (donnees.get('fournisseur') or '').strip().lower()
        if v and fournisseurs.fournisseur(v) is None:
            erreurs['fournisseur'] = 'Fournisseur inconnu.'
        champs['fournisseur'] = v
    if 'base_url' in donnees:
        v = (donnees.get('base_url') or '').strip().rstrip('/')
        if v:
            u = urlparse(v)
            if u.scheme not in ('http', 'https') or not u.netloc:
                erreurs['base_url'] = 'Adresse invalide (http:// ou https://).'
        champs['base_url'] = v
    if 'protocole' in donnees:
        v = (donnees.get('protocole') or '').strip().lower()
        if v not in PROTOCOLES:
            erreurs['protocole'] = 'Protocole : anthropic ou openai.'
        champs['protocole'] = v
    if 'modele' in donnees:
        v = (donnees.get('modele') or '').strip()
        if len(v) > 200:
            erreurs['modele'] = '200 caractères au maximum.'
        champs['modele'] = v
    if 'modeles_secours' in donnees:
        liste = client._decouper(donnees.get('modeles_secours') or [])
        if len(liste) > 10:
            erreurs['modeles_secours'] = '10 modèles de secours au maximum.'
        champs['modeles_secours'] = '\n'.join(liste)
    if 'delai' in donnees:
        v = donnees.get('delai')
        if v in (None, ''):
            champs['delai'] = None
        else:
            try:
                v = int(v)
            except (TypeError, ValueError):
                v = -1
            if not 5 <= v <= 600:
                erreurs['delai'] = 'Délai entre 5 et 600 secondes.'
            champs['delai'] = v
    return champs, erreurs


class ConfigView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.request.method == 'PUT':
            return [permissions.IsAuthenticated(), IsApplicationAdmin()]
        return super().get_permissions()

    def get(self, request):
        return Response(etat(request.user))

    def put(self, request):
        from accounts.audit import journaliser
        from accounts.models import AuditEvent

        champs, erreurs = _valider(request.data)
        nouvelle_cle = request.data.get('cle')
        if nouvelle_cle is not None and not isinstance(nouvelle_cle, str):
            erreurs['cle'] = 'Clé invalide.'
        if erreurs:
            return Response(erreurs, status=status.HTTP_400_BAD_REQUEST)

        cfg = ConfigurationIa.instance()
        avant = {k: getattr(cfg, k) for k in champs}
        for k, v in champs.items():
            setattr(cfg, k, v)
        cle_changee = None
        if request.data.get('effacer_cle'):
            cfg.cle_chiffree, cfg.cle_indice, cle_changee = '', '', 'effacee'
        elif nouvelle_cle and nouvelle_cle.strip():
            cle = nouvelle_cle.strip()
            cfg.cle_chiffree, cfg.cle_indice, cle_changee = chiffrer(cle), indice(cle), 'remplacee'
        cfg.updated_by = request.user
        cfg.save()
        client.invalider_configuration()
        modifies = {k: {'avant': avant[k], 'apres': champs[k]} for k in champs if avant[k] != champs[k]}
        journaliser(AuditEvent.ACTION_IA_CONFIG, request=request,
                    modifications=modifies or None, cle=cle_changee)
        return Response(etat(request.user))


class ConfigReinitialiserView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def post(self, request):
        from accounts.audit import journaliser
        from accounts.models import AuditEvent
        ConfigurationIa.objects.filter(pk=1).delete()
        client.invalider_configuration()
        journaliser(AuditEvent.ACTION_IA_CONFIG, request=request, reinitialisation=True)
        return Response(etat(request.user))


def lister_modeles():
    """Identifiants des modèles du fournisseur effectif (première page)."""
    if client.protocole() == 'openai':
        return openai_compat.lister_modeles(client.adresse(), client.cle())
    page = client._client().models.list(limit=1000)
    return [m.id for m in (getattr(page, 'data', None) or page)]


def _erreur_fournisseur(exc):
    statut = getattr(exc, 'statut', None) or getattr(exc, 'status_code', None)
    if statut in (401, 403):
        return 'Clé refusée par le fournisseur.'
    if statut:
        return f'Le fournisseur a répondu {statut}.'
    return "Service d'IA injoignable."


class ConfigTesterView(APIView):
    """Essai réel : liste des modèles puis petite requête sur chaque modèle configuré."""
    permission_classes = [permissions.IsAuthenticated, IsApplicationAdmin]

    def post(self, request):
        if not client.cle():
            return Response({'ok': False, 'erreur': "Aucune clé d'API n'est configurée."})
        resultat = {'ok': False, 'modeles_accessibles': None, 'essais': []}
        try:
            ids = lister_modeles()
            resultat['modeles_accessibles'] = len(ids)
        except Exception as exc:  # noqa: BLE001 - liste facultative : on tente quand même l'essai
            resultat['liste_erreur'] = _erreur_fournisseur(exc)
        message = [{'role': 'user', 'content': 'Réponds uniquement par : OK'}]
        for nom in client.modeles_essai()[:4]:
            debut = time.monotonic()
            try:
                if client.protocole() == 'openai':
                    r = openai_compat.creer(client.adresse(), client.cle(), modele=nom,
                                            messages=message, max_tokens=400, delai=client.delai())
                else:
                    r = client._client().messages.create(model=nom, max_tokens=400,
                                                         messages=message)
                resultat['essais'].append({'modele': nom, 'ok': True,
                                           'duree': round(time.monotonic() - debut, 1),
                                           'servi_par': r.model, 'reponse': client.texte(r)[:40]})
            except Exception as exc:  # noqa: BLE001 - un essai rapporte, il ne plante pas
                resultat['essais'].append({'modele': nom, 'ok': False,
                                           'erreur': _erreur_fournisseur(exc)})
        resultat['ok'] = any(e['ok'] for e in resultat['essais'])
        return Response(resultat)


class ModelesView(APIView):
    """Modèles du fournisseur, mis en cache 10 min (la liste change peu, l'appel coûte)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not client.cle():
            return Response({'modeles': [], 'erreur': "Aucune clé d'API n'est configurée."})
        empreinte = hashlib.sha256(f'{client.adresse()}|{client.cle()}'.encode()).hexdigest()[:16]
        cle_cache = f'ia:modeles:{empreinte}'
        ids = cache.get(cle_cache)
        if ids is None:
            try:
                ids = lister_modeles()
            except Exception as exc:  # noqa: BLE001
                return Response({'modeles': [], 'erreur': _erreur_fournisseur(exc)})
            cache.set(cle_cache, ids, 600)
        filtre = (request.query_params.get('filtre') or '').strip().lower()
        if filtre:
            ids = [i for i in ids if filtre in i.lower()]
        return Response({'modeles': ids[:500], 'total': len(ids)})


class PreferencesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _donnees(self, request):
        pref = PreferenceIa.objects.filter(utilisateur=request.user).first()
        return {'modele_assistant': pref.modele_assistant if pref else '',
                'modele_par_defaut': client.modele()}

    def get(self, request):
        return Response(self._donnees(request))

    def put(self, request):
        modele = (request.data.get('modele_assistant') or '').strip()
        if len(modele) > 200:
            return Response({'modele_assistant': '200 caractères au maximum.'},
                            status=status.HTTP_400_BAD_REQUEST)
        PreferenceIa.objects.update_or_create(utilisateur=request.user,
                                              defaults={'modele_assistant': modele})
        return Response(self._donnees(request))
