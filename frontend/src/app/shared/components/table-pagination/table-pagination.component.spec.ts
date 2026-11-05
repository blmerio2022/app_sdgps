import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  TablePaginationComponent, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS,
} from './table-pagination.component';

/** Pagination partagée du pied de tableau (unifiée dans les 7 tableaux). */
describe('TablePaginationComponent', () => {
  let fixture: ComponentFixture<TablePaginationComponent>;
  let cmp: TablePaginationComponent;

  const text = () => (fixture.nativeElement as HTMLElement).textContent || '';
  const buttons = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.pg-btn')) as HTMLButtonElement[];
  const select = () => fixture.nativeElement.querySelector('.pg-size-select') as HTMLSelectElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ declarations: [TablePaginationComponent] })
      .compileComponents();
    fixture = TestBed.createComponent(TablePaginationComponent);
    cmp = fixture.componentInstance;
  });

  it('valeurs standard de l’app : 5 par page, options unifiées', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(5);
    expect([...PAGE_SIZE_OPTIONS]).toEqual([5, 10, 25, 50, 100]);
    expect(cmp.pageSize).toBe(5);
  });

  describe('calculs', () => {
    it('nombre de pages', () => {
      cmp.total = 42; cmp.pageSize = 5;
      expect(cmp.totalPages).toBe(9);
      cmp.total = 10; cmp.pageSize = 5;
      expect(cmp.totalPages).toBe(2);
    });

    it('au moins une page même sans élément', () => {
      cmp.total = 0;
      expect(cmp.totalPages).toBe(1);
    });

    it('plage affichée', () => {
      cmp.total = 42; cmp.pageSize = 5; cmp.page = 1;
      expect([cmp.rangeStart, cmp.rangeEnd]).toEqual([1, 5]);
      cmp.page = 3;
      expect([cmp.rangeStart, cmp.rangeEnd]).toEqual([11, 15]);
    });

    it('la dernière page est bornée au total (pas de « 45 sur 42 »)', () => {
      cmp.total = 42; cmp.pageSize = 5; cmp.page = 9;
      expect(cmp.rangeEnd).toBe(42);
    });

    it('liste vide : plage à zéro', () => {
      cmp.total = 0; cmp.page = 1;
      expect(cmp.rangeStart).toBe(0);
      expect(cmp.rangeEnd).toBe(0);
    });
  });

  describe('affichage', () => {
    it('montre la plage, le total et la page courante', () => {
      cmp.total = 42; cmp.pageSize = 5; cmp.page = 2; cmp.entityPlural = 'projets';
      fixture.detectChanges();
      expect(text()).toContain('6');
      expect(text()).toContain('10');
      expect(text()).toContain('42');
      expect(text()).toContain('projets');
      expect(text()).toContain('Page');
    });

    it('liste vide : message dédié', () => {
      cmp.total = 0;
      fixture.detectChanges();
      expect(text()).toContain('Aucun élément');
    });

    it('propose toutes les options de taille', () => {
      fixture.detectChanges();
      const values = Array.from(select().options).map(o => Number(o.value));
      expect(values).toEqual([...PAGE_SIZE_OPTIONS]);
    });
  });

  describe('navigation', () => {
    it('première/précédente désactivées sur la page 1', () => {
      cmp.total = 42; cmp.pageSize = 5; cmp.page = 1;
      fixture.detectChanges();
      const [first, prev, next, last] = buttons();
      expect(first.disabled).toBeTrue();
      expect(prev.disabled).toBeTrue();
      expect(next.disabled).toBeFalse();
      expect(last.disabled).toBeFalse();
    });

    it('suivante/dernière désactivées sur la dernière page', () => {
      cmp.total = 42; cmp.pageSize = 5; cmp.page = 9;
      fixture.detectChanges();
      const [first, prev, next, last] = buttons();
      expect(first.disabled).toBeFalse();
      expect(next.disabled).toBeTrue();
      expect(last.disabled).toBeTrue();
    });

    it('émet les événements granulaires', () => {
      const calls: string[] = [];
      cmp.first.subscribe(() => calls.push('first'));
      cmp.prev.subscribe(() => calls.push('prev'));
      cmp.next.subscribe(() => calls.push('next'));
      cmp.last.subscribe(() => calls.push('last'));
      cmp.total = 42; cmp.pageSize = 5; cmp.page = 5;
      fixture.detectChanges();
      buttons().forEach(b => b.click());
      expect(calls).toEqual(['first', 'prev', 'next', 'last']);
    });
  });

  describe('éléments par page', () => {
    it('émet la nouvelle taille choisie', () => {
      const sizes: number[] = [];
      cmp.pageSizeChange.subscribe(v => sizes.push(v));
      cmp.total = 42;
      fixture.detectChanges();
      cmp.onPageSizeChange('25');
      expect(sizes).toEqual([25]);
    });

    it('n’émet rien si la taille est inchangée ou invalide', () => {
      const sizes: number[] = [];
      cmp.pageSizeChange.subscribe(v => sizes.push(v));
      cmp.pageSize = 10;
      cmp.onPageSizeChange('10');
      cmp.onPageSizeChange('0');
      cmp.onPageSizeChange('abc');
      expect(sizes).toEqual([]);
    });

    it('le <select> reflète la taille courante', () => {
      cmp.pageSize = 25; cmp.total = 42;
      fixture.detectChanges();
      expect(Number(select().value)).toBe(25);
    });
  });
});
