import { lambertVersWgs84, wgs84VersLambert } from './lambert-maroc';

/** Mêmes valeurs de référence que le backend (calculées avec PROJ). */
const REFERENCES: [string, number, number, number, number][] = [
  ['nord', 420000, 380000, 34.015908783935465, -6.264760093280916],
  ['nord', 500000, 300000, 33.29738117918213, -5.398408086977291],
  ['sud', 420000, 380000, 30.416917711849518, -6.231346687730643],
  ['sahara_nord', 1150000, 450000, 26.5484157817148, -5.900449097169448],
  ['sahara_sud', 1450000, 350000, 22.045685448801414, -5.883087922039268],
];

describe('lambert-maroc', () => {
  it('reproduit PROJ pour les 4 zones', () => {
    REFERENCES.forEach(([zone, x, y, lat, lon]) => {
      const [la, lo] = lambertVersWgs84(x, y, zone);
      expect(Math.abs(la - lat)).withContext(zone).toBeLessThan(1e-7);
      expect(Math.abs(lo - lon)).withContext(zone).toBeLessThan(1e-7);
    });
  });

  it('aller-retour au centimètre', () => {
    REFERENCES.forEach(([zone, x, y]) => {
      const [lat, lon] = lambertVersWgs84(x, y, zone);
      const [x2, y2] = wgs84VersLambert(lat, lon, zone);
      expect(Math.hypot(x2 - x, y2 - y)).withContext(zone).toBeLessThan(0.01);
    });
  });

  it('zone inconnue → zone Nord', () => {
    expect(lambertVersWgs84(420000, 380000, 'xx')).toEqual(lambertVersWgs84(420000, 380000, 'nord'));
  });
});
