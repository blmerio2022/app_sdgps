"""
Import en masse d'un dossier : reconnaître le type de chaque fichier déposé.

L'opérateur importait les pièces une par une (type, numéro, correspondance des colonnes à
chaque fois). Il dépose désormais tous les fichiers d'un levé ; l'application propose un
PLAN — type, numéro, correspondance des colonnes, création ou remplacement — que
l'opérateur corrige puis confirme. L'exécution réutilise l'import unitaire
(`POST pieces/import/`, phase 2) : mêmes validations, mêmes droits, même verrou.

Reconnaissance (sans IA, déterministe) :
- en-têtes : part des champs du type retrouvés parmi les colonnes (libellé ou nom
  technique, sans casse, accents, espaces ni ponctuation) et part des colonnes reconnues ;
- nom du fichier : le code du type (« RDN », « lpa »…) en mot isolé donne un bonus, et
  le nombre qui le suit (« RDN_2 », « RDN n°3 ») le numéro d'une pièce répétable ;
- seuls les types applicables à la nature du SDGPS sont candidats.
"""
import re
import unicodedata

from .catalog import PIECE_CATALOG, effective_champs, natures_applicable
from .parsing import parse_uploaded_table

SEUIL_CONFIANCE = 0.35   # en dessous : aucun type proposé, l'opérateur choisit
BONUS_NOM = 0.5
TYPES_NON_TABULAIRES = {'PGSDGPS', 'RDC', 'PPA', 'PPN', 'CCSPA', 'CDC', 'CLC', 'FTR'}


def _norm(texte):
    texte = unicodedata.normalize('NFKD', str(texte or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', texte.lower())


def _code_dans_nom(nom_fichier, code):
    """Le code du type figure-t-il en mot isolé ? Renvoie (trouvé, numéro éventuel)."""
    base = re.sub(r'\.[^.]+$', '', nom_fichier or '')
    m = re.search(rf'(?<![A-Za-z]){re.escape(code)}(?![A-Za-z])[\s_\-.]*(?:n[°o]?\s*)?(\d{{1,3}})?',
                  base, flags=re.IGNORECASE)
    if not m:
        return False, None
    return True, (int(m.group(1)) if m.group(1) else None)


def correspondance(columns, champs):
    """{champ: colonne} par libellé OU nom technique normalisés."""
    par_cle = {}
    for c in columns:
        par_cle.setdefault(_norm(c), c)
    mapping = {}
    for ch in champs:
        for cle in (_norm(ch.get('label')), _norm(ch.get('name'))):
            if cle and cle in par_cle and par_cle[cle] not in mapping.values():
                mapping[ch['name']] = par_cle[cle]
                break
    return mapping


def evaluer_type(code, columns, nom_fichier, custom_map=None):
    champs = [c for c in effective_champs(code, custom_map) if c.get('name') != 'id']
    if not champs:
        return None
    mapping = correspondance(columns, champs)
    part_champs = len(mapping) / len(champs)
    part_colonnes = len(mapping) / max(1, len([c for c in columns if str(c).strip()]))
    score = (2 * part_champs * part_colonnes / (part_champs + part_colonnes)) if mapping else 0.0
    dans_nom, numero = _code_dans_nom(nom_fichier, code)
    if dans_nom:
        score += BONUS_NOM
    return {'type_piece': code, 'score': round(min(score, 1.5), 3), 'mapping': mapping,
            'champs_reconnus': len(mapping), 'champs_total': len(champs),
            'nom_reconnu': dans_nom, 'numero_nom': numero}


def analyser_fichier(fichier, nature_ssdgps, custom_map=None):
    """Plan pour UN fichier : type proposé, candidats, correspondance, aperçu."""
    nom = getattr(fichier, 'name', '') or ''
    try:
        columns, rows = parse_uploaded_table(fichier)
    except ValueError as exc:
        return {'fichier': nom, 'lisible': False, 'erreur': str(exc), 'candidats': [],
                'type_piece': None, 'mapping': {}, 'lignes': 0, 'colonnes': []}
    candidats = []
    for code, d in PIECE_CATALOG.items():
        if code in TYPES_NON_TABULAIRES or not natures_applicable(code, nature_ssdgps):
            continue
        ev = evaluer_type(code, columns, nom, custom_map)
        if ev and ev['score'] > 0:
            ev['libelle'] = d.get('nom', code)
            ev['repetable'] = bool(d.get('repeatable'))
            ev['niveau'] = d.get('niveau', 'ssdgps')
            candidats.append(ev)
    candidats.sort(key=lambda c: (-c['score'], c['type_piece']))
    meilleur = candidats[0] if candidats and candidats[0]['score'] >= SEUIL_CONFIANCE else None
    # Ex æquo en tête (ex. RDN et RDD partagent leurs en-têtes) : choisir serait arbitraire,
    # l'opérateur tranche parmi les candidats.
    ambigu = bool(meilleur and len(candidats) > 1 and candidats[1]['score'] == meilleur['score'])
    if ambigu:
        meilleur = None
    return {
        'fichier': nom, 'lisible': True, 'colonnes': columns, 'lignes': len(rows),
        'apercu': rows[:3],
        'candidats': [{k: c[k] for k in ('type_piece', 'libelle', 'score', 'champs_reconnus',
                                         'champs_total', 'nom_reconnu', 'repetable', 'mapping',
                                         'numero_nom', 'niveau')} for c in candidats[:5]],
        'type_piece': meilleur['type_piece'] if meilleur else None,
        'ambigu': ambigu,
        'confiance': (min(1.0, meilleur['score']) if meilleur else 0.0),
        'mapping': meilleur['mapping'] if meilleur else {},
        'numero': (meilleur['numero_nom'] if meilleur and meilleur['repetable'] else None),
    }


def completer_plan(plan, ssdgps):
    """Numéros manquants des pièces répétables + pièce existante à remplacer."""
    from .models import Piece

    existantes = {}
    for p in Piece.objects.filter(ssdgps=ssdgps, is_deleted=False).only('id', 'type_piece', 'numero', 'session_id'):
        existantes.setdefault((p.type_piece, p.numero), p)
    pris = {}
    for (t, n) in existantes:
        if n:
            pris.setdefault(t, set()).add(n)
    uniques_vus = set()
    for item in plan:
        t = item.get('type_piece')
        item['doublon'] = False
        if not t:
            item['action'] = 'ignorer'
            continue
        repetable = bool(PIECE_CATALOG.get(t, {}).get('repeatable'))
        if not repetable:
            if t in uniques_vus:
                # Deux fichiers pour une pièce unique : le second n'est pas importé d'office.
                item['doublon'] = True
                item['action'] = 'ignorer'
                item['piece_existante'] = None
                continue
            uniques_vus.add(t)
        if repetable and not item.get('numero'):
            n = 1
            while n in pris.get(t, set()):
                n += 1
            item['numero'] = n
        if repetable:
            pris.setdefault(t, set()).add(item['numero'])
        cle = (t, item.get('numero') if repetable else None)
        existante = existantes.get(cle)
        item['piece_existante'] = str(existante.id) if existante else None
        item['action'] = 'remplacer' if existante else 'creer'
    return plan
