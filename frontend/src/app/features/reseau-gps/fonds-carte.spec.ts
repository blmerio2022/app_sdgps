import { FondCatalogue } from '../../core/services/reseau-gps.service';
import {
  CLE_MES_FONDS, MesFonds, ajouterDuCatalogue, chargerMesFonds, enregistrerMesFonds, listeMesFonds,
  nouveauFondPersonnel, retirerFond, validerFond,
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

const CATALOGUE: FondCatalogue[] = [
  { id: 'osm', nom: 'OSM', categorie: 'cartographique', type: 'xyz', url: 'https://a/{z}/{x}/{y}.png', max_zoom: 19,
    attribution: 'osm', licence: 'odbl', description: '' },
  { id: 'esri', nom: 'Esri', categorie: 'satellitaire', type: 'xyz', url: 'https://b/{z}/{y}/{x}', max_zoom: 19,
    attribution: 'esri', licence: 'esri', description: '' },
  { id: 'wms', nom: 'WMS', categorie: 'wms', type: 'wms', url: 'https://c/wms', couches: 'L', attribution: 'x',
    licence: 'x', description: '' },
];

describe('fonds-carte', () => {
  it('démarre sur les fonds par défaut puis relit les choix enregistrés', () => {
    const st = new StockageMemoire();
    const m = chargerMesFonds(['osm', 'esri'], st);
    expect(m.ids).toEqual(['osm', 'esri']);
    expect(m.actif).toBe('osm');
    enregistrerMesFonds({ ...m, ids: ['esri'], actif: 'esri' }, st);
    expect(chargerMesFonds(['osm'], st).ids).toEqual(['esri']);
  });

  it('tolère un stockage corrompu', () => {
    const st = new StockageMemoire();
    st.setItem(CLE_MES_FONDS, '{pas du json');
    expect(chargerMesFonds(['osm'], st).ids).toEqual(['osm']);
  });

  it('liste mes fonds dans l\'ordre (catalogue puis personnels), sans les identifiants disparus', () => {
    const perso = nouveauFondPersonnel({ nom: 'Mien', type: 'xyz', url: 'https://m/{z}/{x}/{y}.png' });
    const liste = listeMesFonds({ ids: ['esri', 'disparu', 'wms'], persos: [perso], actif: null }, CATALOGUE);
    expect(liste.map(f => f.id)).toEqual(['esri', 'wms', perso.id]);
    expect(liste[1].couches).toBe('L');
    expect(liste[0].maxZoom).toBe(19);
  });

  it('retire un fond déjà utilisé et reporte l\'actif', () => {
    let m: MesFonds = { ids: ['osm', 'esri'], persos: [], actif: 'osm' };
    m = retirerFond(m, 'osm');
    expect(m.ids).toEqual(['esri']);
    expect(m.actif).toBe('esri');
    m = retirerFond(m, 'esri');
    expect(m.actif).toBeNull();
  });

  it('ajoute depuis le catalogue sans doublon', () => {
    let m: MesFonds = { ids: ['osm'], persos: [], actif: null };
    m = ajouterDuCatalogue(m, 'esri');
    m = ajouterDuCatalogue(m, 'esri');
    expect(m.ids).toEqual(['osm', 'esri']);
    expect(m.actif).toBe('esri');
  });

  it('valide un fond XYZ ou WMS', () => {
    expect(validerFond({ nom: '', url: 'https://a/{z}/{x}/{y}.png' })).toContain('nom');
    expect(validerFond({ nom: 'A', url: 'ftp://a' })).toContain('http');
    expect(validerFond({ nom: 'A', type: 'xyz', url: 'https://a/tuiles.png' })).toContain('{z}');
    expect(validerFond({ nom: 'A', type: 'xyz', url: 'https://a/{z}/{x}/{y}.png' })).toBeNull();
    expect(validerFond({ nom: 'A', type: 'wms', url: 'https://a/wms' })).toContain('couches');
    expect(validerFond({ nom: 'A', type: 'wms', url: 'https://a/wms?SERVICE=WMS', couches: 'o' })).toContain('sans paramètres');
    expect(validerFond({ nom: 'A', type: 'wms', url: 'https://a/wms', couches: 'ortho' })).toBeNull();
  });

  it('crée un fond personnel normalisé', () => {
    const f = nouveauFondPersonnel({ nom: ' Ortho ', type: 'wms', url: 'https://a/wms', couches: 'o' });
    expect(f.personnel).toBeTrue();
    expect(f.nom).toBe('Ortho');
    expect(f.format).toBe('image/png');
    expect(f.id).toMatch(/^perso-/);
  });
});
