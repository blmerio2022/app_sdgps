import { compareByLevels, sortLevelOf, sortDirOf, sortValue } from './multi-level-sort.util';

describe('multi-level-sort util', () => {
  const rows = [
    { id: 'a', name: 'Alpha', code: 'Z', active: true },
    { id: 'b', name: 'Alpha', code: 'A', active: false },
    { id: 'c', name: 'Beta', code: 'M', active: true },
  ];

  it('sortValue : booléens → 0/1, texte minuscule, null → ""', () => {
    expect(sortValue({ x: true }, 'x')).toBe(1);
    expect(sortValue({ x: false }, 'x')).toBe(0);
    expect(sortValue({ x: 'ABC' }, 'x')).toBe('abc');
    expect(sortValue({ x: null }, 'x')).toBe('');
    expect(sortValue({}, 'x')).toBe('');
  });

  it('compareByLevels : niveau 1 puis départage par niveau 2', () => {
    const levels = [{ field: 'name', dir: 'asc' as const }, { field: 'code', dir: 'asc' as const }];
    const sorted = [...rows].sort((a, b) => compareByLevels(a, b, levels));
    expect(sorted.map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('compareByLevels : sens décroissant du premier niveau', () => {
    const levels = [{ field: 'name', dir: 'desc' as const }];
    const sorted = [...rows].sort((a, b) => compareByLevels(a, b, levels));
    expect(sorted[0].name).toBe('Beta');
  });

  it('sortLevelOf / sortDirOf', () => {
    const levels = [{ field: 'name', dir: 'asc' as const }, { field: 'code', dir: 'desc' as const }];
    expect(sortLevelOf(levels, 'name')).toBe(1);
    expect(sortLevelOf(levels, 'code')).toBe(2);
    expect(sortLevelOf(levels, 'autre')).toBe(0);
    expect(sortDirOf(levels, 'code')).toBe('desc');
    expect(sortDirOf(levels, 'autre')).toBe('');
  });
});
