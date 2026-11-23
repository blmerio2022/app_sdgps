import { wgs84VersLambert } from './lambert-maroc';

/**
 * Calculs des outils de mesure de la carte et des zones — dans le PLAN de la projection
 * Lambert Maroc de la zone choisie (comme les coordonnées du réseau), et non sur la sphère :
 * c'est la référence du topographe, et l'écart reste négligeable à l'échelle d'un chantier.
 */

export type Xy = [number, number];

export function distance(a: Xy, b: Xy): number { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

/** Longueur d'une polyligne et de chacun de ses segments (m). */
export function longueur(points: Xy[]): { totale: number; segments: number[] } {
  const segments = points.slice(1).map((p, i) => distance(points[i], p));
  return { totale: segments.reduce((s, d) => s + d, 0), segments };
}

/** Aire (m², toujours positive) d'un anneau, par la formule du lacet. */
export function aire(anneau: Xy[]): number {
  let s = 0;
  anneau.forEach((p, i) => {
    const q = anneau[(i + 1) % anneau.length];
    s += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(s) / 2;
}

/** Périmètre (m) d'un anneau fermé. */
export function perimetre(anneau: Xy[]): number {
  return anneau.length < 2 ? 0 : longueur([...anneau, anneau[0]]).totale;
}

/** Angle (degrés, 0–180) au sommet `b` entre les directions b→a et b→c. */
export function angleAuSommet(a: Xy, b: Xy, c: Xy): number {
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
  if (!nu || !nv) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Gisement de a vers b (degrés, depuis le Nord, sens horaire, 0–360). */
export function gisement(a: Xy, b: Xy): number {
  const g = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return (g + 360) % 360;
}

export const versGrades = (degres: number) => (degres * 400) / 360;

const fr = (n: number, dec: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function formatDistance(m: number): string {
  return m < 1000 ? `${fr(m, 2)} m` : `${fr(m / 1000, 3)} km`;
}

export function formatAire(m2: number): string {
  if (m2 < 10_000) return `${fr(m2, 1)} m²`;
  if (m2 < 1_000_000) return `${fr(m2 / 10_000, 4)} ha`;
  return `${fr(m2 / 1_000_000, 4)} km² (${fr(m2 / 10_000, 1)} ha)`;
}

export function formatAngle(degres: number): string {
  return `${fr(degres, 4)}° · ${fr(versGrades(degres), 4)} gon`;
}

/** Points [lat, lon] → plan Lambert de la zone. */
export function versPlan(latLons: number[][], zone: string): Xy[] {
  return latLons.map(([lat, lon]) => wgs84VersLambert(lat, lon, zone));
}

/** Aire (m²) et périmètre extérieur (m) d'une zone en WGS84 : polygones [extérieur, trous…]. */
export function mesurerZone(polygones: number[][][][], zone: string): { aire: number; perimetre: number; sommets: number } {
  let surface = 0, contour = 0, sommets = 0;
  for (const poly of polygones) {
    poly.forEach((anneau, k) => {
      const plan = versPlan(anneau, zone);
      sommets += anneau.length;
      surface += (k === 0 ? 1 : -1) * aire(plan);
      if (k === 0) contour += perimetre(plan);
    });
  }
  return { aire: Math.max(0, surface), perimetre: contour, sommets };
}
