"""Conversion Lambert Maroc (datum Merchich) ↔ WGS84, en Python pur.

Paramètres vérifiés contre PROJ (EPSG:26191 / 26192 / 26194 / 26195 et la transformation
« Merchich to WGS 84 (1) ») — cf. `docs/normes-reseau-triangulation-gps.md` §4. Aucune
dépendance (pas de pyproj en production) : la projection conique conforme de Lambert à un
parallèle (Snyder, *Map Projections — A Working Manual*, §15) et une translation
géocentrique à 3 paramètres suffisent à la précision d'un fond de carte (< 1 m d'écart
avec PROJ).
"""
import math

# Clarke 1880 (IGN)
CLARKE_A = 6378249.2
CLARKE_RF = 293.4660212936269
# WGS84
WGS84_A = 6378137.0
WGS84_RF = 298.257223563
# Merchich → WGS84 (translation géocentrique, mètres)
MERCHICH_TOWGS84 = (31.0, 146.0, 47.0)

ZONES = {
    'nord': {'libelle': 'Lambert Nord Maroc (zone I)', 'epsg': 26191,
             'lat0': 33.3, 'lon0': -5.4, 'k0': 0.999625769, 'x0': 500000.0, 'y0': 300000.0},
    'sud': {'libelle': 'Lambert Sud Maroc (zone II)', 'epsg': 26192,
            'lat0': 29.7, 'lon0': -5.4, 'k0': 0.999615596, 'x0': 500000.0, 'y0': 300000.0},
    'sahara_nord': {'libelle': 'Lambert Sahara Nord (zone III)', 'epsg': 26194,
                    'lat0': 26.1, 'lon0': -5.4, 'k0': 0.999616304, 'x0': 1200000.0, 'y0': 400000.0},
    'sahara_sud': {'libelle': 'Lambert Sahara Sud (zone IV)', 'epsg': 26195,
                   'lat0': 22.5, 'lon0': -5.4, 'k0': 0.999616437, 'x0': 1500000.0, 'y0': 400000.0},
}
ZONE_DEFAUT = 'nord'


def _e2(rf):
    f = 1.0 / rf
    return 2 * f - f * f


class _Lambert1SP:
    def __init__(self, zone):
        p = ZONES[zone]
        self.a = CLARKE_A
        self.e = math.sqrt(_e2(CLARKE_RF))
        self.k0, self.x0, self.y0 = p['k0'], p['x0'], p['y0']
        self.lon0 = math.radians(p['lon0'])
        phi0 = math.radians(p['lat0'])
        self.n = math.sin(phi0)
        m0 = self._m(phi0)
        t0 = self._t(phi0)
        self.F = m0 / (self.n * t0 ** self.n)
        self.rho0 = self.a * self.F * t0 ** self.n * self.k0

    def _m(self, phi):
        return math.cos(phi) / math.sqrt(1 - (self.e * math.sin(phi)) ** 2)

    def _t(self, phi):
        es = self.e * math.sin(phi)
        return math.tan(math.pi / 4 - phi / 2) / ((1 - es) / (1 + es)) ** (self.e / 2)

    def direct(self, phi, lam):
        rho = self.a * self.F * self._t(phi) ** self.n * self.k0
        theta = self.n * (lam - self.lon0)
        return self.x0 + rho * math.sin(theta), self.y0 + self.rho0 - rho * math.cos(theta)

    def inverse(self, x, y):
        dx, dy = x - self.x0, self.rho0 - (y - self.y0)
        rho = math.copysign(math.hypot(dx, dy), self.n)
        t = (rho / (self.a * self.k0 * self.F)) ** (1 / self.n)
        theta = math.atan2(dx, dy)
        lam = theta / self.n + self.lon0
        phi = math.pi / 2 - 2 * math.atan(t)
        for _ in range(15):
            es = self.e * math.sin(phi)
            nouveau = math.pi / 2 - 2 * math.atan(t * ((1 - es) / (1 + es)) ** (self.e / 2))
            if abs(nouveau - phi) < 1e-12:
                phi = nouveau
                break
            phi = nouveau
        return phi, lam


def _geo_vers_cart(phi, lam, a, rf, h=0.0):
    e2 = _e2(rf)
    n = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    return ((n + h) * math.cos(phi) * math.cos(lam),
            (n + h) * math.cos(phi) * math.sin(lam),
            (n * (1 - e2) + h) * math.sin(phi))


def _cart_vers_geo(x, y, z, a, rf):
    e2 = _e2(rf)
    lam = math.atan2(y, x)
    p = math.hypot(x, y)
    phi = math.atan2(z, p * (1 - e2))
    for _ in range(10):
        n = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
        h = p / math.cos(phi) - n
        nouveau = math.atan2(z, p * (1 - e2 * n / (n + h)))
        if abs(nouveau - phi) < 1e-13:
            phi = nouveau
            break
        phi = nouveau
    return phi, lam


def lambert_vers_wgs84(x, y, zone=ZONE_DEFAUT):
    """(X, Y) Lambert Maroc de la zone → (latitude, longitude) WGS84 en degrés décimaux."""
    phi, lam = _Lambert1SP(zone).inverse(float(x), float(y))
    cx, cy, cz = _geo_vers_cart(phi, lam, CLARKE_A, CLARKE_RF)
    tx, ty, tz = MERCHICH_TOWGS84
    phi2, lam2 = _cart_vers_geo(cx + tx, cy + ty, cz + tz, WGS84_A, WGS84_RF)
    return math.degrees(phi2), math.degrees(lam2)


def wgs84_vers_lambert(lat, lon, zone=ZONE_DEFAUT):
    """(latitude, longitude) WGS84 → (X, Y) Lambert Maroc de la zone."""
    cx, cy, cz = _geo_vers_cart(math.radians(lat), math.radians(lon), WGS84_A, WGS84_RF)
    tx, ty, tz = MERCHICH_TOWGS84
    phi, lam = _cart_vers_geo(cx - tx, cy - ty, cz - tz, CLARKE_A, CLARKE_RF)
    return _Lambert1SP(zone).direct(phi, lam)


def deviner_zone(texte):
    """Zone déduite d'un libellé libre (« Zone Projection » des pièces PPA/PPN) ou None."""
    s = (texte or '').strip().lower()
    if not s:
        return None
    s = s.replace('é', 'e').replace('-', ' ').replace('_', ' ')
    if 'sahara' in s:
        return 'sahara_sud' if 'sud' in s else 'sahara_nord'
    jetons = s.replace('zone', ' ').split()
    if 'iv' in jetons or '4' in jetons:
        return 'sahara_sud'
    if 'iii' in jetons or '3' in jetons:
        return 'sahara_nord'
    if 'sud' in s or 'ii' in jetons or '2' in jetons:
        return 'sud'
    if 'nord' in s or 'i' in jetons or '1' in jetons:
        return 'nord'
    return None
