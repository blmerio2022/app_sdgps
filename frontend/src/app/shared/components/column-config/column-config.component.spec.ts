import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnConfigComponent } from './column-config.component';
import { ManagedColumn } from './column-config.util';

function make(): { cmp: ColumnConfigComponent; last: () => ManagedColumn[] } {
  const cmp = new ColumnConfigComponent();
  cmp.columns = [
    { field: 'a', label: 'A', visible: true, type: 'text' },
    { field: 'b', label: 'B', visible: true, type: 'number' },
    { field: 'c', label: 'C', visible: false, type: 'date' },
  ];
  let last: ManagedColumn[] = [];
  cmp.columnsChange.subscribe(c => (last = c));
  return { cmp, last: () => last };
}

describe('ColumnConfigComponent (logique)', () => {
  it('open/close pilotent la modale', () => {
    const { cmp } = make();
    cmp.open(); expect(cmp.showColumnConfig).toBeTrue();
    cmp.close(); expect(cmp.showColumnConfig).toBeFalse();
  });

  it('stats total/visibles/masquées', () => {
    const { cmp } = make();
    expect(cmp.total).toBe(3);
    expect(cmp.visibleCount).toBe(2);
    expect(cmp.hiddenCount).toBe(1);
  });

  it('toggleVisibility émet une nouvelle liste avec la visibilité inversée (sans muter l\'entrée)', () => {
    const { cmp, last } = make();
    cmp.toggleVisibility('a');
    expect(last().find(c => c.field === 'a')!.visible).toBeFalse();
    expect(cmp.columns[0].visible).toBeTrue(); // pas de mutation de la source
  });

  it('selectAll / deselectAll / invertSelection', () => {
    const { cmp, last } = make();
    cmp.selectAll(); expect(last().every(c => c.visible)).toBeTrue();
    cmp.deselectAll(); expect(last().every(c => !c.visible)).toBeTrue();
    cmp.invertSelection(); expect(last().map(c => c.visible)).toEqual([false, false, true]);
  });

  it('moveUp / moveDown / moveToTop / moveToBottom réordonnent', () => {
    const { cmp, last } = make();
    cmp.moveDown(0); expect(last().map(c => c.field)).toEqual(['b', 'a', 'c']);
    cmp.moveUp(2); expect(last().map(c => c.field)).toEqual(['a', 'c', 'b']);
    cmp.moveToBottom(0); expect(last().map(c => c.field)).toEqual(['b', 'c', 'a']);
    cmp.moveToTop(2); expect(last().map(c => c.field)).toEqual(['c', 'a', 'b']);
  });

  it('drag & drop réordonne à la dépose', () => {
    const { cmp, last } = make();
    cmp.onDragStart(0);
    cmp.onDrop(2);
    expect(last().map(c => c.field)).toEqual(['b', 'c', 'a']);
    expect(cmp.draggedIndex).toBeNull();
  });

  it('filtre « visibles » ne montre que les colonnes visibles', () => {
    const { cmp } = make();
    cmp.applyFilter('visible');
    expect(cmp.filteredColumns.map(c => c.field)).toEqual(['a', 'b']);
    expect(cmp.filterLabel).toBe('Colonnes visibles');
  });

  it('askReset ouvre la confirmation, confirmReset émet resetToSource', () => {
    const { cmp } = make();
    const spy = jasmine.createSpy('reset');
    cmp.resetToSource.subscribe(spy);
    cmp.askReset(); expect(cmp.showResetConfirm).toBeTrue();
    cmp.confirmReset();
    expect(cmp.showResetConfirm).toBeFalse();
    expect(spy).toHaveBeenCalled();
  });

  it('descOf : describe() prioritaire, puis col.description, sinon chaîne vide', () => {
    const { cmp } = make();
    // Colonne portant sa propre description, sans describe() branché.
    cmp.columns = [
      { field: 'a', label: 'A', visible: true, description: 'Desc portée' },
      { field: 'b', label: 'B', visible: true },
    ];
    expect(cmp.descOf(cmp.columns[0])).toBe('Desc portée');
    expect(cmp.descOf(cmp.columns[1])).toBe('');
    // describe() (fourni par le parent) l'emporte sur la description portée.
    cmp.describe = (field: string) => (field === 'a' ? 'Desc parent' : '');
    expect(cmp.descOf(cmp.columns[0])).toBe('Desc parent');
    expect(cmp.descOf(cmp.columns[1])).toBe('');
  });

  it('askReset ne fait rien pendant une réinitialisation en cours', () => {
    const { cmp } = make();
    cmp.resetting = true;
    cmp.askReset();
    expect(cmp.showResetConfirm).toBeFalse();
  });
});

/**
 * Mise en page de la modale (DOM réel + styles du composant). Test de NON-RÉGRESSION du bug
 * « les compteurs Total / Visibles / Masquées sont partiellement masqués » : ils étaient
 * recouverts par l'en-tête de grille collant. Le correctif sort les compteurs de la zone de
 * défilement (seule `.column-scroll` défile), l'en-tête ne peut donc plus les chevaucher.
 */
describe('ColumnConfigComponent (mise en page de la modale)', () => {
  let fixture: ComponentFixture<ColumnConfigComponent>;
  let cmp: ColumnConfigComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ declarations: [ColumnConfigComponent] }).compileComponents();
    fixture = TestBed.createComponent(ColumnConfigComponent);
    cmp = fixture.componentInstance;
    // Liste longue → la zone de défilement est réellement active.
    cmp.columns = Array.from({ length: 40 }, (_, i) => ({
      field: `f${i}`, label: `Colonne ${i}`, visible: i % 2 === 0, type: 'text',
      description: `Description assez longue de la colonne ${i} pour occuper la cellule`,
    }));
    cmp.open();
    fixture.detectChanges();
  });

  it('les compteurs sont hors de la zone de défilement (cause racine du masquage)', () => {
    const host: HTMLElement = fixture.nativeElement;
    const stats = host.querySelector('.col-stats') as HTMLElement;
    const scroll = host.querySelector('.column-scroll') as HTMLElement;
    expect(stats).toBeTruthy();
    expect(scroll).toBeTruthy();
    expect(scroll.contains(stats)).toBeFalse();
  });

  it('les compteurs ne sont pas recouverts par la zone de défilement / l’en-tête collant', () => {
    const host: HTMLElement = fixture.nativeElement;
    const stats = (host.querySelector('.col-stats') as HTMLElement).getBoundingClientRect();
    const scroll = (host.querySelector('.column-scroll') as HTMLElement).getBoundingClientRect();
    expect(stats.height).toBeGreaterThan(0);
    // Invariant indépendant du viewport : les compteurs se terminent AVANT la zone de défilement,
    // donc avant l'en-tête collant qui vit à l'intérieur de celle-ci.
    expect(stats.bottom).toBeLessThanOrEqual(scroll.top + 0.5);

    // Si l'en-tête est affiché (viewport large), il commence lui aussi après les compteurs.
    const headerEl = host.querySelector('.column-grid-header') as HTMLElement;
    if (headerEl.offsetParent !== null) {
      expect(stats.bottom).toBeLessThanOrEqual(headerEl.getBoundingClientRect().top + 0.5);
    }
  });

  it('les trois pastilles affichent les bons compteurs', () => {
    const host: HTMLElement = fixture.nativeElement;
    const chips = Array.from(host.querySelectorAll('.col-stats .stat')) as HTMLElement[];
    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toContain('40');  // total
    expect(chips[1].textContent).toContain('20');  // visibles
    expect(chips[2].textContent).toContain('20');  // masquées
    // Chaque pastille a une surface réelle (rien d'écrasé / de tronqué à zéro).
    chips.forEach(c => expect(c.getBoundingClientRect().height).toBeGreaterThan(0));
  });
});

/**
 * Test de NON-RÉGRESSION : « le défilement remonte en haut à chaque modification ».
 * Chaque modification émet une NOUVELLE liste de colonnes ; sans `trackBy`, Angular recrée tous
 * les `<li>` et la position de défilement retombe à 0. Le parent réaffecte `columns` (auto-save)
 * comme en conditions réelles.
 *
 * ⚠️ Le garde-fou EFFECTIF est « les nœuds DOM sont RÉUTILISÉS » : c'est le seul test qui échoue
 * si l'on retire `trackBy` (vérifié). Les assertions sur `scrollTop` documentent l'invariant
 * attendu mais ne suffisent pas à détecter la régression en Karma headless, où la recréation
 * synchrone des lignes conserve la hauteur totale et donc la position de défilement.
 */
describe('ColumnConfigComponent (conservation du défilement)', () => {
  let fixture: ComponentFixture<ColumnConfigComponent>;
  let cmp: ColumnConfigComponent;
  let scroll: HTMLElement;

  /** Simule le parent : applique la nouvelle liste puis relance la détection de changements. */
  function applyLikeParent(): void {
    cmp.columnsChange.subscribe(cols => { cmp.columns = cols; });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ declarations: [ColumnConfigComponent] }).compileComponents();
    fixture = TestBed.createComponent(ColumnConfigComponent);
    cmp = fixture.componentInstance;
    cmp.columns = Array.from({ length: 60 }, (_, i) => ({
      field: `f${i}`, label: `Colonne ${i}`, visible: i % 2 === 0, type: 'text',
      description: `Description de la colonne ${i}`,
    }));
    applyLikeParent();
    cmp.open();
    fixture.detectChanges();
    scroll = fixture.nativeElement.querySelector('.column-scroll') as HTMLElement;
    // Se placer au milieu de la liste.
    scroll.scrollTop = Math.floor((scroll.scrollHeight - scroll.clientHeight) / 2);
    fixture.detectChanges();
  });

  it('la zone de défilement est réellement scrollable dans le test', () => {
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    expect(scroll.scrollTop).toBeGreaterThan(0);
  });

  it('bascule de visibilité : la position de défilement est conservée', () => {
    const before = scroll.scrollTop;
    cmp.toggleVisibility('f30');
    fixture.detectChanges();
    expect(scroll.scrollTop).toBe(before);
  });

  it('réordonnancement : la position de défilement est conservée', () => {
    const before = scroll.scrollTop;
    cmp.moveDown(30);
    fixture.detectChanges();
    expect(scroll.scrollTop).toBe(before);
  });

  it('tout sélectionner / inverser : la position de défilement est conservée', () => {
    const before = scroll.scrollTop;
    cmp.selectAll();
    fixture.detectChanges();
    cmp.invertSelection();
    fixture.detectChanges();
    expect(scroll.scrollTop).toBe(before);
  });

  it('les nœuds DOM sont RÉUTILISÉS (trackBy) et non recréés', () => {
    const first = scroll.querySelector('.column-item') as HTMLElement;
    cmp.toggleVisibility('f30');
    fixture.detectChanges();
    // Même instance d'élément → Angular n'a pas détruit/recréé la ligne.
    expect(scroll.querySelector('.column-item')).toBe(first);
  });
});
