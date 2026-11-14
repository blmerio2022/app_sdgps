import {
  CLE_FONDS_PERSONNELS, FONDS_INTEGRES, chargerFondsPersonnels, enregistrerFondsPersonnels,
  nouveauFondPersonnel, validerFond,
} from './fonds-carte';

class StockageMemoire implements Storage {
  private d: Record<string, string> = {};
  get length() { return Object.keys(this.d).length; }
  clear() { this.d = {}; }
  getItem(k: string) { return k in this.d ? this.d[k] : null; }
  key(i: number) { return Object.keys(this.d)[i] ?? null; }
  removeItem(k: string) { delete this.d[k]; }
  setItem(k: string, v: string) { this.d[k] = v; }
}

describe('fonds-carte', () => {
  it('intègre OSM et une imagerie satellite, mais pas Google', () => {
    const ids = FONDS_INTEGRES.map(f => f.id);
    expect(ids).toContain('osm');
    expect(ids).toContain('esri-imagerie');
    expect(FONDS_INTEGRES.some(f => /google/i.test(f.url))).toBeFalse();
    expect(FONDS_INTEGRES.every(f => !!f.attribution)).toBeTrue();
  });

  it('valide un fond XYZ ou WMS', () => {
    expect(validerFond({ nom: '', url: 'https://a/{z}/{x}/{y}.png' })).toContain('nom');
    expect(validerFond({ nom: 'A', url: 'ftp://a' })).toContain('http');
    expect(validerFond({ nom: 'A', type: 'xyz', url: 'https://a/tuiles.png' })).toContain('{z}');
    expect(validerFond({ nom: 'A', type: 'xyz', url: 'https://a/{z}/{x}/{y}.png' })).toBeNull();
    expect(validerFond({ nom: 'A', type: 'wms', url: 'https://a/wms' })).toContain('couches');
    expect(validerFond({ nom: 'A', type: 'wms', url: 'https://a/wms', couches: 'ortho' })).toBeNull();
  });

  it('enregistre et recharge les seuls fonds personnels', () => {
    const st = new StockageMemoire();
    const perso = nouveauFondPersonnel({ nom: ' Ortho ', type: 'wms', url: 'https://a/wms', couches: 'o' });
    expect(perso.personnel).toBeTrue();
    expect(perso.nom).toBe('Ortho');
    expect(perso.format).toBe('image/png');
    enregistrerFondsPersonnels([...FONDS_INTEGRES, perso], st);
    const relus = chargerFondsPersonnels(st);
    expect(relus.length).toBe(1);
    expect(relus[0].id).toBe(perso.id);
  });

  it('tolère un stockage corrompu', () => {
    const st = new StockageMemoire();
    st.setItem(CLE_FONDS_PERSONNELS, '{pas du json');
    expect(chargerFondsPersonnels(st)).toEqual([]);
  });
});
