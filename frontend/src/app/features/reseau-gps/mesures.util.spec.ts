import {
  aire, angleAuSommet, formatAire, formatAngle, formatDistance, gisement, longueur, mesurerZone, perimetre, versGrades,
} from './mesures.util';
import { lambertVersWgs84 } from './lambert-maroc';

describe('mesures.util', () => {
  it('longueur, segments, aire et périmètre dans le plan', () => {
    expect(longueur([[0, 0], [3, 4], [3, 10]])).toEqual({ totale: 11, segments: [5, 6] });
    const carre: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(aire(carre)).toBe(10000);
    expect(aire([...carre].reverse())).toBe(10000);              // orientation indifférente
    expect(perimetre(carre)).toBe(400);
  });

  it('angle au sommet et gisement (depuis le Nord, sens horaire)', () => {
    expect(angleAuSommet([1, 0], [0, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(angleAuSommet([1, 0], [0, 0], [-1, 0])).toBeCloseTo(180, 9);
    expect(angleAuSommet([0, 0], [0, 0], [1, 1])).toBe(0);
    expect(gisement([0, 0], [0, 10])).toBe(0);
    expect(gisement([0, 0], [10, 0])).toBe(90);
    expect(gisement([0, 0], [-10, 0])).toBe(270);
    expect(versGrades(90)).toBe(100);
  });

  it('formats français (m / km, m² / ha / km², degrés et grades)', () => {
    expect(formatDistance(12.345)).toBe('12,35 m');
    expect(formatDistance(1234.5)).toBe('1,235 km');
    expect(formatAire(500)).toBe('500,0 m²');
    expect(formatAire(25000)).toBe('2,5000 ha');
    expect(formatAire(2_500_000)).toContain('km²');
    expect(formatAngle(90)).toContain('100,0000 gon');
  });

  it('mesure une zone WGS84 dans le plan Lambert, trous déduits', () => {
    const pt = (x: number, y: number) => lambertVersWgs84(x, y, 'nord');
    const ext = [pt(420000, 380000), pt(421000, 380000), pt(421000, 381000), pt(420000, 381000)];
    const trou = [pt(420200, 380200), pt(420400, 380200), pt(420400, 380400), pt(420200, 380400)];
    const m = mesurerZone([[ext, trou]], 'nord');
    expect(m.aire).toBeCloseTo(1_000_000 - 40_000, -1);
    expect(m.perimetre).toBeCloseTo(4000, 0);
    expect(m.sommets).toBe(8);
  });
});
