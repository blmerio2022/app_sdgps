/**
 * Lambert Maroc (datum Merchich, Clarke 1880 IGN) ↔ WGS84 — portage fidèle de
 * `backend/reseaux/projection.py` (mêmes paramètres, vérifiés contre PROJ). Sert à afficher
 * les points sans aller-retour serveur et à convertir un clic sur la carte en X/Y Lambert.
 */

interface ParamZone { lat0: number; lon0: number; k0: number; x0: number; y0: number; }

export const ZONES_LAMBERT: Record<string, ParamZone> = {
  nord: { lat0: 33.3, lon0: -5.4, k0: 0.999625769, x0: 500000, y0: 300000 },
  sud: { lat0: 29.7, lon0: -5.4, k0: 0.999615596, x0: 500000, y0: 300000 },
  sahara_nord: { lat0: 26.1, lon0: -5.4, k0: 0.999616304, x0: 1200000, y0: 400000 },
  sahara_sud: { lat0: 22.5, lon0: -5.4, k0: 0.999616437, x0: 1500000, y0: 400000 },
};

const CLARKE_A = 6378249.2;
const CLARKE_RF = 293.4660212936269;
const WGS84_A = 6378137.0;
const WGS84_RF = 298.257223563;
const TOWGS84 = [31.0, 146.0, 47.0];
const RAD = Math.PI / 180;

const e2 = (rf: number) => { const f = 1 / rf; return 2 * f - f * f; };

class Lambert1SP {
  private e = Math.sqrt(e2(CLARKE_RF));
  private n: number; private F: number; private rho0: number; private lon0: number;
  constructor(private p: ParamZone) {
    const phi0 = p.lat0 * RAD;
    this.lon0 = p.lon0 * RAD;
    this.n = Math.sin(phi0);
    this.F = this.m(phi0) / (this.n * Math.pow(this.t(phi0), this.n));
    this.rho0 = CLARKE_A * this.F * Math.pow(this.t(phi0), this.n) * p.k0;
  }
  private m(phi: number) { return Math.cos(phi) / Math.sqrt(1 - Math.pow(this.e * Math.sin(phi), 2)); }
  private t(phi: number) {
    const es = this.e * Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - es) / (1 + es), this.e / 2);
  }
  direct(phi: number, lam: number): [number, number] {
    const rho = CLARKE_A * this.F * Math.pow(this.t(phi), this.n) * this.p.k0;
    const theta = this.n * (lam - this.lon0);
    return [this.p.x0 + rho * Math.sin(theta), this.p.y0 + this.rho0 - rho * Math.cos(theta)];
  }
  inverse(x: number, y: number): [number, number] {
    const dx = x - this.p.x0, dy = this.rho0 - (y - this.p.y0);
    const rho = Math.sign(this.n) * Math.hypot(dx, dy);
    const t = Math.pow(rho / (CLARKE_A * this.p.k0 * this.F), 1 / this.n);
    const lam = Math.atan2(dx, dy) / this.n + this.lon0;
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 15; i++) {
      const es = this.e * Math.sin(phi);
      const suivant = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), this.e / 2));
      if (Math.abs(suivant - phi) < 1e-12) { phi = suivant; break; }
      phi = suivant;
    }
    return [phi, lam];
  }
}

function geoVersCart(phi: number, lam: number, a: number, rf: number): [number, number, number] {
  const ee = e2(rf);
  const n = a / Math.sqrt(1 - ee * Math.sin(phi) ** 2);
  return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - ee) * Math.sin(phi)];
}

function cartVersGeo(x: number, y: number, z: number, a: number, rf: number): [number, number] {
  const ee = e2(rf);
  const lam = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - ee));
  for (let i = 0; i < 10; i++) {
    const n = a / Math.sqrt(1 - ee * Math.sin(phi) ** 2);
    const h = p / Math.cos(phi) - n;
    const suivant = Math.atan2(z, p * (1 - ee * n / (n + h)));
    if (Math.abs(suivant - phi) < 1e-13) { phi = suivant; break; }
    phi = suivant;
  }
  return [phi, lam];
}

/** (X, Y) Lambert de la zone → [latitude, longitude] WGS84 (degrés). */
export function lambertVersWgs84(x: number, y: number, zone = 'nord'): [number, number] {
  const [phi, lam] = new Lambert1SP(ZONES_LAMBERT[zone] || ZONES_LAMBERT['nord']).inverse(x, y);
  const [cx, cy, cz] = geoVersCart(phi, lam, CLARKE_A, CLARKE_RF);
  const [p2, l2] = cartVersGeo(cx + TOWGS84[0], cy + TOWGS84[1], cz + TOWGS84[2], WGS84_A, WGS84_RF);
  return [p2 / RAD, l2 / RAD];
}

/** [latitude, longitude] WGS84 → (X, Y) Lambert de la zone. */
export function wgs84VersLambert(lat: number, lon: number, zone = 'nord'): [number, number] {
  const [cx, cy, cz] = geoVersCart(lat * RAD, lon * RAD, WGS84_A, WGS84_RF);
  const [phi, lam] = cartVersGeo(cx - TOWGS84[0], cy - TOWGS84[1], cz - TOWGS84[2], CLARKE_A, CLARKE_RF);
  return new Lambert1SP(ZONES_LAMBERT[zone] || ZONES_LAMBERT['nord']).direct(phi, lam);
}
