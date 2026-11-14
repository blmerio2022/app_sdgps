"""Version de l'application : `v<majeure>.<mineure>.<n>`.

Règle :
- `<majeure>.<mineure>` vient du repère git `base/vX.Y` le plus récent atteignable depuis
  HEAD (posé UNE fois au début de la branche `feature/vX.Y`) ;
- `<n>` = nombre de commits de la branche depuis ce repère, en ne suivant que le
  PREMIER parent (`--first-parent`). Les commits arrivés par la fusion de `develop`
  ne sont pas recomptés : une fusion ajoute 1, comme un commit. Le numéro ne fait
  donc qu'augmenter, de 1 par commit ;
- `+local` si `backend/` ou `frontend/` portent des modifications non commitées : ce
  qui tourne n'est alors pas exactement un commit identifiable.

Le repère ne commence PAS par `v` : la CI déploie sur les tags `v*`.

La version est calculée là où git est disponible :
- au BUILD (script ci-dessous, appelé avant `railway up` et dans la CI) → fichier
  `build-info/version.json`, intégré à l'image (le serveur n'a pas le dossier `.git`) ;
- en DÉVELOPPEMENT, directement depuis git si le fichier est absent.

Ce module n'importe pas Django au chargement : il sert aussi de script autonome.

    python backend/backend/version.py --ecrire build-info/version.json
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

PREFIXE_REPERE = 'base/v'
INCONNUE = 'inconnue'
RACINE_DEPOT = Path(__file__).resolve().parents[2]
FICHIERS_VERSION = (
    # Image Docker : `build-info/` est copié à côté de manage.py (/app/build-info).
    Path(__file__).resolve().parents[1] / 'build-info' / 'version.json',
    # Dépôt : fichier généré à la racine (avant `railway up`).
    RACINE_DEPOT / 'build-info' / 'version.json',
)


def _git(*args, cwd=RACINE_DEPOT):
    resultat = subprocess.run(
        ['git', *args], cwd=cwd, capture_output=True, text=True, timeout=10,
    )
    if resultat.returncode != 0:
        raise RuntimeError(resultat.stderr.strip() or 'git a échoué')
    return resultat.stdout.strip()


def formater(majeure_mineure, n, local=False):
    """`('1.0', 34)` → `v1.0.34` (`v1.0.34+local` si l'arbre est modifié)."""
    return f"v{majeure_mineure}.{n}{'+local' if local else ''}"


def majeure_mineure_du_repere(repere):
    """`base/v1.0` → `1.0` ; None si le nom ne suit pas la convention."""
    m = re.fullmatch(re.escape(PREFIXE_REPERE) + r'(\d+\.\d+)', repere or '')
    return m.group(1) if m else None


def calculer_depuis_git(cwd=RACINE_DEPOT):
    """Calcule la version depuis l'historique git. Lève si git ou le repère manque."""
    repere = _git('describe', '--tags', '--match', f'{PREFIXE_REPERE}*', '--abbrev=0', cwd=cwd)
    mm = majeure_mineure_du_repere(repere)
    if mm is None:
        raise RuntimeError(f'repère de version mal nommé : {repere}')
    n = int(_git('rev-list', '--count', '--first-parent', f'{repere}..HEAD', cwd=cwd))
    modifie = bool(_git('status', '--porcelain', '--untracked-files=no', '--',
                        'backend', 'frontend', cwd=cwd))
    return {
        'version': formater(mm, n, modifie),
        'commit': _git('rev-parse', '--short', 'HEAD', cwd=cwd),
        'date_commit': _git('log', '-1', '--format=%cI', cwd=cwd),
        'date_build': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }


def _defaut():
    return {'version': INCONNUE, 'commit': '', 'date_commit': '', 'date_build': ''}


@lru_cache(maxsize=1)
def version_info():
    """Version de l'instance qui tourne : fichier de build, sinon git, sinon « inconnue »."""
    for chemin in FICHIERS_VERSION:
        if chemin.is_file():
            try:
                return {**_defaut(), **json.loads(chemin.read_text(encoding='utf-8'))}
            except (OSError, ValueError):
                continue
    try:
        return calculer_depuis_git()
    except Exception:  # git absent, dépôt sans repère… : la version ne bloque jamais l'app
        return _defaut()


def _main(argv):
    if len(argv) != 2 or argv[0] != '--ecrire':
        print('usage : python backend/backend/version.py --ecrire <fichier.json>')
        return 2
    info = calculer_depuis_git()
    cible = Path(argv[1])
    cible.parent.mkdir(parents=True, exist_ok=True)
    cible.write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"{info['version']} ({info['commit']}) → {cible}")
    return 0


if __name__ == '__main__':
    sys.exit(_main(sys.argv[1:]))
