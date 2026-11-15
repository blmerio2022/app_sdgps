"""
Export complet d'un dossier SDGPS en une archive ZIP (archivage, envoi au service du
cadastre).

Contenu :
- `LISEZMOI.txt` — fiche récapitulative lisible (hiérarchie, statut, liste des pièces) ;
- `dossier.json` — la même fiche, exploitable par un programme ;
- `donnees/` — les données de chaque pièce en CSV (Excel FR : `;`, BOM UTF-8), colonnes
  libellées comme dans l'application ;
- `sources/` — les fichiers importés d'origine, tels que déposés ;
- `photos/` — les images des pièces (photos PPA/PPN, croquis…) ;
- `rapport/` — le dernier rapport PDF généré et conservé (s'il existe) : l'export ne
  relance pas un rendu de plusieurs minutes.

L'archive est construite dans un fichier temporaire (jamais entièrement en mémoire).
Les pièces supprimées (corbeille) ne sont pas exportées.
"""
import csv
import io
import json
import os
import re
import tempfile
import zipfile

from django.utils import timezone

PLAFOND_OCTETS = 500 * 1024 * 1024   # au-delà, l'export est refusé (dossier anormal)


def _slug(texte, longueur=60):
    texte = re.sub(r'[^\w\-]+', '_', str(texte or ''), flags=re.UNICODE).strip('_')
    return texte[:longueur] or 'x'


def _nom_piece(piece, index):
    base = f"{index:02d}_{piece.type_piece}"
    if piece.numero:
        base += f"_{piece.numero}"
    if piece.session_id and getattr(piece.session, 'numero_session', None):
        base += f"_S{piece.session.numero_session}"
    return base


def _csv_de_la_piece(piece):
    from pieces.catalog import effective_champs

    rows = (piece.payload or {}).get('rows')
    if not isinstance(rows, list) or not rows:
        return None
    try:
        champs = [c for c in effective_champs(piece.type_piece) if c.get('name') != 'id']
    except KeyError:
        champs = []
    noms = [c['name'] for c in champs]
    # Colonnes présentes dans les données mais absentes du catalogue : gardées en fin.
    for r in rows:
        if isinstance(r, dict):
            for k in r:
                if k not in noms and k != 'id':
                    noms.append(k)
    libelles = {c['name']: c.get('label') or c['name'] for c in champs}
    tampon = io.StringIO()
    tampon.write(chr(0xFEFF))   # BOM : Excel reconnaît l'UTF-8
    ecrivain = csv.writer(tampon, delimiter=';', lineterminator='\r\n')
    ecrivain.writerow([libelles.get(n, n) for n in noms])
    for r in rows:
        r = r if isinstance(r, dict) else {}
        ecrivain.writerow(['' if r.get(n) is None else r.get(n) for n in noms])
    return tampon.getvalue().encode('utf-8')


def fiche(ssdgps, pieces):
    affaire = ssdgps.affaire
    propriete = affaire.propriete
    projet = propriete.projet
    return {
        'export': {'date': timezone.now().isoformat(), 'application': 'SDGPS'},
        'projet': {'code': projet.code_projet, 'nom': projet.nom_projet,
                   'organisation': getattr(projet.organization, 'name', '')},
        'propriete': {'nom': propriete.nom_propriete, 'requisition': propriete.id_requisition,
                      'titre': propriete.id_titre},
        'affaire': {'numero_sd': affaire.numero_sd_affaire, 'nature': affaire.nature_affaire,
                    'procedure': affaire.nature_procedure_affaire},
        'ssdgps': {'numero': ssdgps.numero_ssdgps, 'nature': ssdgps.nature_ssdgps,
                   'type': ssdgps.type_ssdgps, 'statut': ssdgps.get_statut_display(),
                   'statut_depuis': ssdgps.statut_change_at.isoformat() if ssdgps.statut_change_at else None,
                   'motif': ssdgps.motif_statut or None},
        'pieces': [{
            'ordre': i, 'type': p.type_piece, 'libelle': p.get_type_piece_display(), 'numero': p.numero,
            'session': getattr(p.session, 'numero_session', None) if p.session_id else None,
            'statut': p.get_statut_display(), 'lignes': len((p.payload or {}).get('rows') or []),
            'images': p.images.count(), 'commentaire': p.commentaire or '',
        } for i, p in enumerate(pieces, start=1)],
    }


def _lisezmoi(f):
    l = [
        'DOSSIER SDGPS — export', '=' * 60,
        f"Exporté le      : {f['export']['date'][:19].replace('T', ' ')}",
        f"Projet          : {f['projet']['code']} — {f['projet']['nom']}",
        f"Organisation    : {f['projet']['organisation']}",
        f"Propriété       : {f['propriete']['nom']}"
        + (f" (titre {f['propriete']['titre']})" if f['propriete']['titre'] else '')
        + (f" (réquisition {f['propriete']['requisition']})" if f['propriete']['requisition'] else ''),
        f"Affaire         : SD {f['affaire']['numero_sd']} — {f['affaire']['nature']}",
        f"SDGPS           : n°{f['ssdgps']['numero']} — {f['ssdgps']['nature']} ({f['ssdgps']['type']})",
        f"Statut          : {f['ssdgps']['statut']}" + (f" — motif : {f['ssdgps']['motif']}" if f['ssdgps']['motif'] else ''),
        '', f"PIÈCES ({len(f['pieces'])})", '-' * 60,
    ]
    for p in f['pieces']:
        l.append(f"{p['ordre']:>2}. {p['type']:<8} {p['libelle']}"
                 + (f" n°{p['numero']}" if p['numero'] else '')
                 + (f" — session {p['session']}" if p['session'] else '')
                 + f" — {p['statut']}, {p['lignes']} ligne(s), {p['images']} image(s)")
    l += ['', 'CONTENU DE L\'ARCHIVE', '-' * 60,
          'donnees/   données de chaque pièce (CSV, séparateur « ; »)',
          'sources/   fichiers importés d\'origine',
          'photos/    images des pièces',
          'rapport/   dernier rapport PDF généré (s\'il existe)',
          'dossier.json  cette fiche au format JSON', '']
    return '\r\n'.join(l).encode('utf-8')


def _ajouter_fichier(zf, champ_fichier, chemin):
    """Ajoute un FileField à l'archive ; renvoie les octets ajoutés (0 si absent)."""
    if not champ_fichier:
        return 0
    try:
        with champ_fichier.open('rb') as src:
            donnees = src.read()
    except (FileNotFoundError, OSError, ValueError):
        return 0
    zf.writestr(chemin, donnees)
    return len(donnees)


class ExportTropVolumineux(Exception):
    pass


def construire_zip(ssdgps):
    """Construit l'archive ; renvoie (fichier temporaire ouvert positionné au début, nom, stats)."""
    from pieces.models import Piece, RapportGeneration

    pieces = list(Piece.objects.filter(ssdgps=ssdgps, is_deleted=False)
                  .select_related('session').prefetch_related('images')
                  .order_by('ordre', 'type_piece', 'numero'))
    f = fiche(ssdgps, pieces)
    stats = {'pieces': len(pieces), 'sources': 0, 'photos': 0, 'csv': 0, 'rapport': False}
    total = 0
    tmp = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    with zipfile.ZipFile(tmp, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('LISEZMOI.txt', _lisezmoi(f))
        zf.writestr('dossier.json', json.dumps(f, ensure_ascii=False, indent=2))
        for i, p in enumerate(pieces, start=1):
            nom = _nom_piece(p, i)
            contenu = _csv_de_la_piece(p)
            if contenu:
                zf.writestr(f'donnees/{nom}.csv', contenu)
                stats['csv'] += 1
            if p.fichier:
                ext = os.path.splitext(p.fichier.name)[1] or ''
                n = _ajouter_fichier(zf, p.fichier, f'sources/{nom}{ext}')
                total += n
                stats['sources'] += 1 if n else 0
            for j, img in enumerate(p.images.all(), start=1):
                ext = os.path.splitext(img.fichier.name or '')[1] or '.jpg'
                suffixe = f"_{_slug(img.point_ref, 30)}" if img.point_ref else ''
                n = _ajouter_fichier(zf, img.fichier, f'photos/{nom}/{j:03d}{suffixe}{ext}')
                total += n
                stats['photos'] += 1 if n else 0
            if total > PLAFOND_OCTETS:
                break
        rapport = (RapportGeneration.objects.filter(ssdgps=ssdgps, statut=RapportGeneration.Statut.TERMINE)
                   .exclude(fichier='').order_by('-finished_at').first())
        if rapport is not None and _ajouter_fichier(zf, rapport.fichier, f'rapport/{rapport.nom_fichier or "rapport.pdf"}'):
            stats['rapport'] = True
    if total > PLAFOND_OCTETS:
        tmp.close()
        raise ExportTropVolumineux(
            f"Le dossier dépasse {max(1, PLAFOND_OCTETS // (1024 * 1024))} Mo : export refusé.")
    tmp.seek(0)
    projet = ssdgps.affaire.propriete.projet
    nom_zip = (f"SDGPS_{_slug(projet.code_projet, 30)}_SD{ssdgps.affaire.numero_sd_affaire}"
               f"_N{ssdgps.numero_ssdgps}_{timezone.localdate():%Y%m%d}.zip")
    return tmp, nom_zip, stats
