import { MultiLevelSortComponent } from './multi-level-sort.component';
import { OrgSortLevel } from '../../../core/services/org-sort-config.service';

/** Composant présentationnel : instanciation directe, on capte les émissions `levelsChange`. */
describe('MultiLevelSortComponent', () => {
  let cmp: MultiLevelSortComponent;
  let emitted: OrgSortLevel[] | null;

  beforeEach(() => {
    cmp = new MultiLevelSortComponent();
    cmp.sortableFields = [
      { field: 'a', label: 'A' },
      { field: 'b', label: 'B' },
      { field: 'c', label: 'C' },
    ];
    emitted = null;
    cmp.levelsChange.subscribe(l => (emitted = l));
  });

  it('open / close pilotent la modale', () => {
    expect(cmp.showSortConfig).toBeFalse();
    cmp.open();
    expect(cmp.showSortConfig).toBeTrue();
    cmp.close();
    expect(cmp.showSortConfig).toBeFalse();
  });

  it('addLevel émet un nouveau niveau avec le premier champ inutilisé', () => {
    cmp.levels = [];
    cmp.addLevel();
    expect(emitted).toEqual([{ field: 'a', dir: 'asc' }]);
  });

  it('canAddLevel faux quand tous les champs sont utilisés', () => {
    cmp.levels = [{ field: 'a', dir: 'asc' }, { field: 'b', dir: 'asc' }, { field: 'c', dir: 'asc' }];
    expect(cmp.canAddLevel).toBeFalse();
  });

  it('removeLevel retire le niveau', () => {
    cmp.levels = [{ field: 'a', dir: 'asc' }, { field: 'b', dir: 'asc' }];
    cmp.removeLevel(0);
    expect(emitted).toEqual([{ field: 'b', dir: 'asc' }]);
  });

  it('moveLevelToTop / moveLevelToBottom déplacent aux extrémités', () => {
    cmp.levels = [{ field: 'a', dir: 'asc' }, { field: 'b', dir: 'asc' }, { field: 'c', dir: 'asc' }];
    cmp.moveLevelToBottom(0);
    expect(emitted!.map(l => l.field)).toEqual(['b', 'c', 'a']);
    cmp.levels = emitted!;
    cmp.moveLevelToTop(2);
    expect(emitted!.map(l => l.field)).toEqual(['a', 'b', 'c']);
  });

  it('clearAllLevels émet une liste vide', () => {
    cmp.levels = [{ field: 'a', dir: 'asc' }];
    cmp.clearAllLevels();
    expect(emitted).toEqual([]);
  });

  it('changeLevelField refuse un doublon', () => {
    cmp.levels = [{ field: 'a', dir: 'asc' }, { field: 'b', dir: 'asc' }];
    cmp.changeLevelField(1, 'a'); // déjà utilisé au niveau 0
    expect(emitted).toBeNull();
  });

  it('changeLevelDir change le sens', () => {
    cmp.levels = [{ field: 'a', dir: 'asc' }];
    cmp.changeLevelDir(0, 'desc');
    expect(emitted).toEqual([{ field: 'a', dir: 'desc' }]);
  });

  it('fieldsForLevel exclut les champs utilisés ailleurs', () => {
    const lv0 = { field: 'a', dir: 'asc' as const };
    cmp.levels = [lv0, { field: 'b', dir: 'asc' }];
    const avail = cmp.fieldsForLevel(lv0).map(f => f.field);
    expect(avail).toContain('a');       // le champ courant reste proposé
    expect(avail).not.toContain('b');   // utilisé ailleurs
  });

  it('sortSummary résume les niveaux', () => {
    cmp.levels = [];
    expect(cmp.sortSummary).toBe('Aucun tri');
    cmp.levels = [{ field: 'a', dir: 'desc' }];
    expect(cmp.sortSummary).toContain('A');
    expect(cmp.sortSummary).toContain('↓');
  });

  it('confirmResetSort émet resetToSource et ferme la confirmation', () => {
    let reset = false;
    cmp.resetToSource.subscribe(() => (reset = true));
    cmp.askResetSort();
    expect(cmp.showResetConfirm).toBeTrue();
    cmp.confirmResetSort();
    expect(reset).toBeTrue();
    expect(cmp.showResetConfirm).toBeFalse();
  });
});
