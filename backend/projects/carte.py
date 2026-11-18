"""
Carte des dossiers : position de chaque SDGPS visible, pour une vue d'ensemble de
l'activité (dossiers voisins, points anciens réutilisables, répartition par statut).

Position = centre des points anciens (LPA ; à défaut, détermination définitive RDD),
coordonnées Lambert Maroc converties en WGS84 par `reseaux.projection` (vérifiée contre
PROJ). La zone Lambert vient de la colonne « Zone Projection » des PPA / PPN, comme dans le
module Réseau GPS ; sans elle, la zone par défaut (Nord) est supposée et la position est
marquée `zone_supposee`. Une position hors du Maroc (coordonnées absurdes, mauvaise zone)
est écartée plutôt qu'affichée en mer. Rien n'est enregistré : tout est recalculé.
"""
from reseaux.projection import ZONE_DEFAUT, deviner_zone, lambert_vers_wgs84

from .models import Ssdgps

# Emprise large du Maroc (Sahara compris) : au-delà, la position est jugée fausse.
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 20.5, 36.5, -17.5, -0.8


def nombre(v):
    s = str(v if v is not None else '').strip().replace(' ', '').replace(' ', '')
    if ',' in s and '.' not in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def centre(rows):
    pts = [(nombre(r.get('x_m')), nombre(r.get('y_m'))) for r in rows or []]
    pts = [(x, y) for x, y in pts if x is not None and y is not None and x > 0 and y > 0]
    if not pts:
        return None
    return sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts), len(pts)


def dossiers(user) -> dict:
    from pieces.models import Piece

    from .views import scope_queryset

    qs = scope_queryset(Ssdgps.objects.filter(is_deleted=False, affaire__is_deleted=False,
                                              affaire__propriete__is_deleted=False,
                                              affaire__propriete__projet__is_deleted=False),
                        user, 'affaire__propriete__projet__organization_id')
    liste = list(qs.select_related('affaire__propriete__projet'))
    ids = [s.id for s in liste]

    points, zones = {}, {}
    pieces = (Piece.objects.filter(ssdgps_id__in=ids, is_deleted=False,
                                   type_piece__in=('LPA', 'RDD', 'PPA', 'PPN'))
              .only('ssdgps_id', 'type_piece', 'payload', 'updated_at').order_by('-updated_at'))
    for p in pieces:
        rows = (p.payload or {}).get('rows') or []
        if p.type_piece in ('PPA', 'PPN'):
            if p.ssdgps_id not in zones:
                for r in rows:
                    z = deviner_zone(r.get('zone_projection')) or deviner_zone(r.get('systeme_projection'))
                    if z:
                        zones[p.ssdgps_id] = z
                        break
            continue
        # LPA prioritaire sur RDD ; la plus récente d'abord.
        rang = 0 if p.type_piece == 'LPA' else 1
        if p.ssdgps_id in points and points[p.ssdgps_id][0] <= rang:
            continue
        c = centre(rows)
        if c:
            points[p.ssdgps_id] = (rang, c, p.type_piece)

    resultats, sans_position = [], 0
    for ss in liste:
        info = points.get(ss.id)
        if info is None:
            sans_position += 1
            continue
        _, (x, y, n), source = info
        zone = zones.get(ss.id)
        try:
            lat, lon = lambert_vers_wgs84(x, y, zone or ZONE_DEFAUT)
        except (ValueError, ZeroDivisionError, OverflowError):
            sans_position += 1
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            sans_position += 1
            continue
        a = ss.affaire
        p = a.propriete
        resultats.append({
            'id': str(ss.id), 'titre': f'SDGPS n°{ss.numero_ssdgps} — {ss.nature_ssdgps}',
            'nature': ss.nature_ssdgps, 'statut': ss.statut, 'statut_display': ss.get_statut_display(),
            'contexte': ' · '.join(x for x in [p.projet.code_projet, p.nom_propriete, f'SD {a.numero_sd_affaire}'] if x),
            'lat': round(lat, 6), 'lon': round(lon, 6), 'nb_points': n, 'source': source,
            'zone': zone or ZONE_DEFAUT, 'zone_supposee': zone is None,
            'lien': f'projets/{p.projet_id}/pieces/{ss.id}?proprieteId={p.id}&affaireId={a.id}',
        })
    return {'dossiers': resultats, 'sans_position': sans_position, 'total': len(liste)}
