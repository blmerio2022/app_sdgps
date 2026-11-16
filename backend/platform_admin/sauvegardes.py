"""
Sauvegarde et restauration de la base (et, en option, des fichiers).

Une sauvegarde est une archive ZIP rangée dans le stockage de l'application
(`default_storage`, sous `sauvegardes/` — S3 si configuré, sinon `media/`) :
- `manifeste.json` : date, environnement, version, applications, nombre d'objets ;
- `donnees.json`   : `dumpdata` de toutes les applications (hors tables techniques
  régénérées par Django : types de contenu, permissions, sessions, journal de l'admin) ;
- `medias/…`       : les fichiers déposés (option `avec_medias`), hors sauvegardes.

⚠ Sur un hébergement au disque éphémère (Railway sans volume), seules les sauvegardes
écrites dans un stockage objet (S3) survivent à un redéploiement.

La RESTAURATION remplace TOUTE la base par le contenu de l'archive (`flush` puis
`loaddata`) — y compris le journal d'audit et les sessions : tout le monde est déconnecté.
Elle crée d'abord une sauvegarde de sécurité de l'état courant, puis journalise.
"""
import io
import json
import os
import re
import tempfile
import zipfile

from django.conf import settings
from django.core import management
from django.core.files.base import File
from django.core.files.storage import default_storage
from django.utils import timezone

DOSSIER = 'sauvegardes'
EXCLUS = ['contenttypes', 'auth.permission', 'sessions', 'admin.logentry']
NOM_VALIDE = re.compile(r'^sdgps-[a-z]+-\d{8}-\d{6}(-[a-z]+)?\.zip$')


class SauvegardeErreur(Exception):
    pass


def _environnement():
    return getattr(settings, 'ENVIRONMENT', 'development')


def chemin(nom):
    if not NOM_VALIDE.match(nom or ''):
        raise SauvegardeErreur('Nom de sauvegarde invalide.')
    return f'{DOSSIER}/{nom}'


def lister():
    try:
        _, fichiers = default_storage.listdir(DOSSIER)
    except (FileNotFoundError, OSError):
        return []
    out = []
    for nom in fichiers:
        if not NOM_VALIDE.match(nom):
            continue
        p = f'{DOSSIER}/{nom}'
        try:
            taille = default_storage.size(p)
            date = default_storage.get_modified_time(p)
        except (OSError, NotImplementedError):
            taille, date = None, None
        out.append({'nom': nom, 'taille': taille, 'date': date,
                    'avec_medias': nom.endswith('-complete.zip'), 'securite': nom.endswith('-securite.zip')})
    return sorted(out, key=lambda s: s['nom'], reverse=True)


def _ajouter_medias(zf):
    racine = getattr(settings, 'MEDIA_ROOT', None)
    if not racine or not os.path.isdir(racine):
        return 0
    n = 0
    for dossier, _, fichiers in os.walk(racine):
        rel = os.path.relpath(dossier, racine).replace('\\', '/')
        if rel == DOSSIER or rel.startswith(DOSSIER + '/'):
            continue
        for f in fichiers:
            complet = os.path.join(dossier, f)
            zf.write(complet, 'medias/' + os.path.relpath(complet, racine).replace('\\', '/'))
            n += 1
    return n


def creer(avec_medias=False, suffixe=None):
    """Crée une sauvegarde ; renvoie son descriptif."""
    from backend.version import version_info

    horodatage = timezone.localtime().strftime('%Y%m%d-%H%M%S')
    marque = suffixe or ('complete' if avec_medias else None)
    nom = f"sdgps-{re.sub('[^a-z]', '', _environnement().lower()) or 'env'}-{horodatage}" + (f'-{marque}' if marque else '') + '.zip'
    tampon = io.StringIO()
    management.call_command('dumpdata', exclude=EXCLUS, natural_foreign=True, stdout=tampon, verbosity=0)
    donnees = tampon.getvalue()
    nb_objets = donnees.count('"model":')
    with tempfile.TemporaryFile() as tmp:
        with zipfile.ZipFile(tmp, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('donnees.json', donnees)
            nb_medias = _ajouter_medias(zf) if avec_medias else 0
            try:
                version = version_info().get('version')
            except Exception:  # noqa: BLE001
                version = None
            zf.writestr('manifeste.json', json.dumps({
                'date': timezone.now().isoformat(), 'environnement': _environnement(), 'version': version,
                'objets': nb_objets, 'medias': nb_medias, 'avec_medias': avec_medias,
            }, ensure_ascii=False, indent=2))
        tmp.seek(0)
        default_storage.save(f'{DOSSIER}/{nom}', File(tmp, name=nom))
    return {'nom': nom, 'objets': nb_objets, 'medias': nb_medias, 'avec_medias': avec_medias}


def purger(retention):
    """Garde les `retention` sauvegardes les plus récentes (hors sauvegardes de sécurité)."""
    if not retention or retention < 1:
        return []
    candidates = [s for s in lister() if not s['securite']]
    supprimees = []
    for s in candidates[retention:]:
        default_storage.delete(f"{DOSSIER}/{s['nom']}")
        supprimees.append(s['nom'])
    return supprimees


def ouvrir(nom):
    p = chemin(nom)
    if not default_storage.exists(p):
        raise SauvegardeErreur('Sauvegarde introuvable.')
    return default_storage.open(p, 'rb')


def supprimer(nom):
    p = chemin(nom)
    if not default_storage.exists(p):
        raise SauvegardeErreur('Sauvegarde introuvable.')
    default_storage.delete(p)


def restaurer(nom, confirmation):
    """Remplace la base par la sauvegarde `nom`. `confirmation` = nom EXACT de l'environnement."""
    if confirmation != _environnement():
        raise SauvegardeErreur(f"Confirmation incorrecte : saisissez exactement « {_environnement()} ».")
    with ouvrir(nom) as f, zipfile.ZipFile(io.BytesIO(f.read())) as zf:
        if 'donnees.json' not in zf.namelist():
            raise SauvegardeErreur("Archive invalide : « donnees.json » absent.")
        donnees = zf.read('donnees.json')
        json.loads(donnees)   # archive lisible avant de toucher à quoi que ce soit
        securite = creer(suffixe='securite')
        with tempfile.NamedTemporaryFile('wb', suffix='.json', delete=False) as tmp:
            tmp.write(donnees)
            chemin_tmp = tmp.name
        try:
            management.call_command('flush', interactive=False, verbosity=0)
            management.call_command('loaddata', chemin_tmp, verbosity=0)
        finally:
            os.unlink(chemin_tmp)
        medias = [n for n in zf.namelist() if n.startswith('medias/') and not n.endswith('/')]
        racine = getattr(settings, 'MEDIA_ROOT', None)
        if medias and racine:
            for n in medias:
                cible = os.path.normpath(os.path.join(racine, n[len('medias/'):]))
                if not cible.startswith(os.path.normpath(str(racine))):
                    continue   # chemin hors du dossier des médias : ignoré
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                with open(cible, 'wb') as out:
                    out.write(zf.read(n))
    return {'restauree': nom, 'sauvegarde_securite': securite['nom'], 'medias': len(medias)}
