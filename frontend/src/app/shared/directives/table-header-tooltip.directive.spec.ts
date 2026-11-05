import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TableHeaderTooltipDirective } from './table-header-tooltip.directive';

@Component({
  template: `
    <table><thead><tr>
      <th appTableHeaderTooltip
          [tipLabel]="label"
          [tipDescription]="description"
          [tipType]="type"
          [tipSortLevel]="sortLevel"
          [tipSortDir]="sortDir">En-tête</th>
    </tr></thead></table>`,
})
class HostComponent {
  label = 'Créé le';
  description = "Date et heure de création de l'enregistrement";
  type: string | undefined = 'date';
  sortLevel = 0;
  sortDir: '' | 'asc' | 'desc' = '';
}

/** Info-bulle unifiée des en-têtes de tableau (structure identique dans toute l'app). */
describe('TableHeaderTooltipDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let th: HTMLElement;

  const tip = () => document.querySelector('.app-th-tooltip') as HTMLElement | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [HostComponent, TableHeaderTooltipDirective],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    th = fixture.nativeElement.querySelector('th');
  });

  afterEach(() => { tip()?.remove(); });

  /** Survole l'en-tête et laisse passer le délai d'apparition. */
  function hover(): void {
    th.dispatchEvent(new MouseEvent('mouseenter'));
    tick(200);
  }

  it('n’affiche rien avant le délai, puis affiche l’info-bulle', fakeAsync(() => {
    th.dispatchEvent(new MouseEvent('mouseenter'));
    tick(50);
    expect(tip()).toBeNull();
    tick(200);
    expect(tip()).not.toBeNull();
  }));

  it('affiche la structure unifiée : titre, type, description et actions', fakeAsync(() => {
    hover();
    const el = tip()!;
    expect(el.querySelector('.tt-title')!.textContent).toBe('Créé le');
    expect(el.querySelector('.tt-type')!.textContent).toBe('DATE');
    expect(el.querySelector('.tt-desc')!.textContent)
      .toBe("Date et heure de création de l'enregistrement");
    const meta = el.querySelector('.tt-meta')!.textContent!;
    expect(meta).toContain('Clic : configurer le tri multi-niveaux');
    expect(meta).toContain('Clic droit : plus d’options');
  }));

  it('n’affiche l’état de tri que si la colonne est triée', fakeAsync(() => {
    hover();
    expect(tip()!.querySelector('.tt-sort')).toBeNull();
    th.dispatchEvent(new MouseEvent('mouseleave'));

    host.sortLevel = 2;
    host.sortDir = 'desc';
    fixture.detectChanges();
    hover();
    const sort = tip()!.querySelector('.tt-sort')!;
    expect(sort.textContent).toContain('niveau');
    expect(sort.textContent).toContain('2');
    expect(sort.textContent).toContain('décroissant');
  }));

  it('masque l’info-bulle au mouseleave, au clic et au clic droit', fakeAsync(() => {
    for (const evt of ['mouseleave', 'click', 'contextmenu']) {
      hover();
      expect(tip()).withContext(evt).not.toBeNull();
      th.dispatchEvent(new MouseEvent(evt));
      expect(tip()).withContext(evt).toBeNull();
    }
  }));

  it('masque l’info-bulle au défilement (elle est en position fixed)', fakeAsync(() => {
    hover();
    expect(tip()).not.toBeNull();
    window.dispatchEvent(new Event('scroll'));
    expect(tip()).toBeNull();
  }));

  it('échappe le contenu injecté (libellés issus de l’API)', fakeAsync(() => {
    host.label = '<img src=x onerror="alert(1)">';
    host.description = '<script>alert(2)</script>';
    fixture.detectChanges();
    hover();
    const el = tip()!;
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('.tt-title')!.textContent).toBe('<img src=x onerror="alert(1)">');
  }));

  it('n’affiche rien sans libellé (aucune info-bulle vide)', fakeAsync(() => {
    host.label = '';
    fixture.detectChanges();
    hover();
    expect(tip()).toBeNull();
  }));

  it('ne s’affiche pas tant qu’un menu de filtre de colonne est ouvert', fakeAsync(() => {
    // Le menu de filtre vit dans <body> : l'info-bulle ne doit ni le recouvrir ni se rouvrir
    // quand l'opérateur survole ce menu (régression corrigée).
    const menu = document.createElement('div');
    menu.className = 'col-filter-menu';
    document.body.appendChild(menu);
    hover();
    expect(tip()).toBeNull();

    menu.remove();
    th.dispatchEvent(new MouseEvent('mouseleave'));
    hover();
    expect(tip()).not.toBeNull();
  }));

  it('supprime l’info-bulle à la destruction du composant', fakeAsync(() => {
    hover();
    expect(tip()).not.toBeNull();
    fixture.destroy();
    expect(tip()).toBeNull();
  }));

  it('omet la description et le type quand ils ne sont pas fournis', fakeAsync(() => {
    host.description = '';
    host.type = undefined;
    fixture.detectChanges();
    hover();
    expect(tip()!.querySelector('.tt-desc')).toBeNull();
    expect(tip()!.querySelector('.tt-type')).toBeNull();
    expect(tip()!.querySelector('.tt-title')!.textContent).toBe('Créé le');
  }));
});
