import { applyColumnsConfig, toColumnPrefs, ManagedColumn } from './column-config.util';

const catalog: ManagedColumn[] = [
  { field: 'a', label: 'A', visible: true, type: 'text' },
  { field: 'b', label: 'B', visible: true, type: 'number' },
  { field: 'c', label: 'C', visible: false, type: 'date' },
];

describe('column-config.util', () => {
  describe('applyColumnsConfig', () => {
    it('renvoie une copie du catalogue si stored est vide/nul', () => {
      const out = applyColumnsConfig(catalog, []);
      expect(out).toEqual(catalog);
      expect(out).not.toBe(catalog);
      expect(out[0]).not.toBe(catalog[0]); // copies profondes de 1er niveau
      expect(applyColumnsConfig(catalog, null)).toEqual(catalog);
    });

    it('réordonne selon stored et applique la visibilité', () => {
      const out = applyColumnsConfig(catalog, [
        { field: 'c', visible: true },
        { field: 'a', visible: false },
        { field: 'b', visible: true },
      ]);
      expect(out.map(c => c.field)).toEqual(['c', 'a', 'b']);
      expect(out.map(c => c.visible)).toEqual([true, false, true]);
    });

    it('ajoute en fin les colonnes du catalogue absentes de stored (nouvelles)', () => {
      const out = applyColumnsConfig(catalog, [{ field: 'b', visible: false }]);
      expect(out.map(c => c.field)).toEqual(['b', 'a', 'c']);
      expect(out.find(c => c.field === 'b')!.visible).toBeFalse();
      // 'a' et 'c' gardent la visibilité du catalogue
      expect(out.find(c => c.field === 'a')!.visible).toBeTrue();
      expect(out.find(c => c.field === 'c')!.visible).toBeFalse();
    });

    it('ignore les entrées de stored inconnues du catalogue', () => {
      const out = applyColumnsConfig(catalog, [
        { field: 'obsolete', visible: true },
        { field: 'a', visible: false },
      ]);
      expect(out.map(c => c.field)).toEqual(['a', 'b', 'c']);
      expect(out[0].visible).toBeFalse();
    });

    it('ne mute pas le catalogue source', () => {
      applyColumnsConfig(catalog, [{ field: 'a', visible: false }]);
      expect(catalog[0].visible).toBeTrue();
    });
  });

  describe('toColumnPrefs', () => {
    it('réduit à [{field, visible}] en conservant l\'ordre', () => {
      expect(toColumnPrefs(catalog)).toEqual([
        { field: 'a', visible: true }, { field: 'b', visible: true }, { field: 'c', visible: false },
      ]);
    });
  });
});
