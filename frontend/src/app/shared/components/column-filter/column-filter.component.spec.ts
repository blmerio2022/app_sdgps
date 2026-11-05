import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ColumnFilterComponent } from './column-filter.component';

/** Filtre de colonne façon Excel : bouton d'en-tête + menu (options, recherche, valeurs). */
describe('ColumnFilterComponent', () => {
  let fixture: ComponentFixture<ColumnFilterComponent>;
  let cmp: ColumnFilterComponent;

  const rows = [
    { ville: 'Rabat' }, { ville: 'Casablanca' }, { ville: 'Rabat' }, { ville: 'Agadir' }, { ville: '' },
  ];

  /** Ouvre le menu comme le ferait un clic sur le bouton. */
  function open(): void {
    const btn = fixture.nativeElement.querySelector('.btn-col-filter') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ColumnFilterComponent],
      imports: [FormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(ColumnFilterComponent);
    cmp = fixture.componentInstance;
    cmp.field = 'ville';
    cmp.label = 'Ville';
    cmp.rows = rows;
    fixture.detectChanges();
  });

  afterEach(() => {
    // Le menu peut avoir été déplacé dans <body> : on nettoie pour ne pas polluer les autres specs
    // (l'info-bulle des en-têtes se masque justement quand un menu de filtre est présent).
    fixture.destroy();
    document.querySelectorAll('.col-filter-menu').forEach(el => el.remove());
  });

  it('le menu est fermé au départ et s’ouvre au clic sur le bouton', () => {
    expect(fixture.nativeElement.querySelector('.col-filter-menu')).toBeNull();
    open();
    expect(cmp.open).toBeTrue();
    expect(fixture.nativeElement.querySelector('.col-filter-menu')).not.toBeNull();
  });

  it('calcule les valeurs distinctes à l’ouverture, tout coché par défaut', () => {
    open();
    expect(cmp.facets.map(f => f.value)).toEqual(['Agadir', 'Casablanca', 'Rabat', '']);
    expect(cmp.selectedCount).toBe(4);
    expect(cmp.allVisibleChecked).toBeTrue();
  });

  it('repart de la sélection existante quand la colonne est déjà filtrée', () => {
    cmp.selected = ['Rabat'];
    open();
    expect(cmp.selectedCount).toBe(1);
    expect(cmp.isChecked('Rabat')).toBeTrue();
    expect(cmp.isChecked('Agadir')).toBeFalse();
    expect(cmp.isFiltered).toBeTrue();
  });

  it('la recherche restreint les valeurs (insensible casse/accents)', () => {
    open();
    cmp.search = 'rab';
    expect(cmp.visibleFacets.map(f => f.value)).toEqual(['Rabat']);
    cmp.search = 'zzz';
    expect(cmp.visibleFacets.length).toBe(0);
  });

  it('« Tout sélectionner » ne porte que sur les valeurs visibles (comme Excel)', () => {
    open();
    cmp.search = 'rab';
    cmp.toggleAllVisible();               // décoche Rabat (seule visible)
    expect(cmp.isChecked('Rabat')).toBeFalse();
    expect(cmp.isChecked('Agadir')).toBeTrue();   // hors recherche : inchangé
    cmp.toggleAllVisible();
    expect(cmp.isChecked('Rabat')).toBeTrue();
  });

  it('applique la sélection et émet les valeurs retenues', () => {
    const emitted: (string[] | null)[] = [];
    cmp.selectedChange.subscribe(v => emitted.push(v));
    open();
    cmp.toggleValue('Agadir');
    cmp.toggleValue('Casablanca');
    cmp.apply();
    expect(emitted[0]).toEqual(['Rabat', '']);
    expect(cmp.open).toBeFalse();
  });

  it('émet null quand TOUTES les valeurs sont retenues (aucun filtre)', () => {
    const emitted: (string[] | null)[] = [];
    cmp.selectedChange.subscribe(v => emitted.push(v));
    open();
    cmp.apply();
    expect(emitted[0]).toBeNull();
  });

  it('« Effacer » retire le filtre', () => {
    const emitted: (string[] | null)[] = [];
    cmp.selected = ['Rabat'];
    cmp.selectedChange.subscribe(v => emitted.push(v));
    open();
    cmp.clear();
    expect(emitted[0]).toBeNull();
    expect(cmp.open).toBeFalse();
  });

  it('interdit d’appliquer une sélection vide (filtrerait tout le tableau)', () => {
    open();
    cmp.facets.forEach(f => cmp.toggleValue(f.value));   // tout décocher
    expect(cmp.selectedCount).toBe(0);
    expect(cmp.canApply).toBeFalse();
  });

  it('relaie les options du menu contextuel et ferme le menu', () => {
    const calls: string[] = [];
    cmp.openSort.subscribe(() => calls.push('sort'));
    cmp.hideColumn.subscribe(() => calls.push('hide'));
    cmp.openColumnConfig.subscribe(() => calls.push('columns'));

    open(); cmp.onSort();
    expect(cmp.open).toBeFalse();
    open(); cmp.onHide();
    open(); cmp.onColumns();
    expect(calls).toEqual(['sort', 'hide', 'columns']);
  });

  it('se ferme sur Échap, au clic extérieur et au défilement', () => {
    open();
    cmp.onEscape();
    expect(cmp.open).toBeFalse();

    open();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    cmp.onDocumentClick({ target: document.body } as unknown as MouseEvent);
    expect(cmp.open).toBeFalse();

    open();
    cmp.onViewportChange();
    expect(cmp.open).toBeFalse();
  });

  it('utilise le formateur fourni pour les valeurs affichées', () => {
    cmp.rows = [{ actif: true }, { actif: false }, { actif: true }];
    cmp.field = 'actif';
    cmp.format = (r: any) => (r.actif ? 'Actif' : 'Inactif');
    open();
    expect(cmp.facets.map(f => f.value)).toEqual(['Actif', 'Inactif']);
    expect(cmp.facets.find(f => f.value === 'Actif')!.count).toBe(2);
  });
});

/**
 * Corrections de comportement du menu (non-régression) :
 *  1. le menu est sorti du `<th>` (attaché à <body>) — sans quoi survoler le menu rouvre
 *     l'info-bulle de l'en-tête et les clics internes remontent au `<th>` (modale de tri) ;
 *  2. le menu tient ENTIÈREMENT dans la fenêtre (bascule + hauteur bornée, liste défilante) ;
 *  3. il passe au-dessus de l'info-bulle et des en-têtes collants.
 */
describe('ColumnFilterComponent (menu détaché et ajusté)', () => {
  let fixture: ComponentFixture<ColumnFilterComponent>;
  let cmp: ColumnFilterComponent;

  const menuEl = () => document.querySelector('.col-filter-menu') as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ColumnFilterComponent],
      imports: [FormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(ColumnFilterComponent);
    cmp = fixture.componentInstance;
    cmp.field = 'ville';
    cmp.label = 'Ville';
    // Beaucoup de valeurs → la liste doit défiler à l'intérieur du menu.
    cmp.rows = Array.from({ length: 120 }, (_, i) => ({ ville: `Ville ${i}` }));
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.col-filter-menu').forEach(el => el.remove());
  });

  /** Ouvre et laisse passer le `setTimeout` de détachement/positionnement. */
  function openMenu(): void {
    (fixture.nativeElement.querySelector('.btn-col-filter') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    jasmine.clock().tick(1);
    fixture.detectChanges();
  }

  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('le menu est attaché à <body> et n’est plus un descendant du composant', () => {
    openMenu();
    const menu = menuEl()!;
    expect(menu.parentElement).toBe(document.body);
    expect(fixture.nativeElement.contains(menu)).toBeFalse();
  });

  it('le menu tient dans la fenêtre : hauteur bornée et liste défilante', () => {
    openMenu();
    const menu = menuEl()!;
    const maxH = parseFloat(menu.style.maxHeight);
    expect(maxH).toBeGreaterThan(0);
    expect(maxH).toBeLessThanOrEqual(window.innerHeight);
    // Position dans la fenêtre.
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0);
  });

  it('un clic dans le menu ne le ferme pas (il n’est plus dans le host)', () => {
    openMenu();
    const inside = menuEl()!.querySelector('.cf-values') as HTMLElement;
    cmp.onDocumentClick({ target: inside } as unknown as MouseEvent);
    expect(cmp.open).toBeTrue();
    // Un clic réellement extérieur ferme bien le menu.
    cmp.onDocumentClick({ target: document.body } as unknown as MouseEvent);
    expect(cmp.open).toBeFalse();
  });

  it('apply/clear stoppent la propagation (sinon le <th> ouvre la modale de tri)', () => {
    openMenu();
    const ev = new MouseEvent('click', { bubbles: true });
    const stop = spyOn(ev, 'stopPropagation');
    cmp.apply(ev);
    expect(stop).toHaveBeenCalled();

    openMenu();
    const ev2 = new MouseEvent('click', { bubbles: true });
    const stop2 = spyOn(ev2, 'stopPropagation');
    cmp.clear(ev2);
    expect(stop2).toHaveBeenCalled();
  });

  it('le menu ne survit pas à la destruction du composant', () => {
    openMenu();
    expect(menuEl()).not.toBeNull();
    fixture.destroy();
    expect(menuEl()).toBeNull();
  });
});

/** Colonne de type DATE : arborescence Année ▸ Mois ▸ Jour, cases parentes (comme Excel). */
describe('ColumnFilterComponent (colonne de type date)', () => {
  let fixture: ComponentFixture<ColumnFilterComponent>;
  let cmp: ColumnFilterComponent;

  function open(): void {
    (fixture.nativeElement.querySelector('.btn-col-filter') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ColumnFilterComponent],
      imports: [FormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(ColumnFilterComponent);
    cmp = fixture.componentInstance;
    cmp.field = 'd';
    cmp.label = 'Créé le';
    cmp.type = 'date';
    cmp.rows = [
      { d: '2026-01-02T00:00:00Z' },
      { d: '2026-01-15T00:00:00Z' },
      { d: '2025-12-01T00:00:00Z' },
      { d: null },
    ];
    cmp.format = (r: any) => {
      if (!r.d) return '—';
      const dt = new Date(r.d);
      return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    };
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.col-filter-menu').forEach(el => el.remove());
  });

  it('construit l’arborescence chronologique et annonce le bon type de filtre', () => {
    open();
    expect(cmp.isDateMode).toBeTrue();
    expect(cmp.kindLabel).toBe('Filtres chronologiques');
    expect(cmp.dateTree.map(y => y.label)).toEqual(['2025', '2026']);
    // Les valeurs non datées restent filtrables, à part.
    expect(cmp.dateOthers.map(f => f.value)).toEqual(['—']);
  });

  it('cocher une année coche toutes ses dates ; décocher n’affecte pas les autres années', () => {
    open();
    const y2026 = cmp.dateTree[1];
    expect(cmp.nodeChecked(y2026)).toBeTrue();      // tout est coché à l'ouverture
    cmp.toggleNode(y2026);
    expect(cmp.nodeChecked(y2026)).toBeFalse();
    expect(cmp.isChecked('02/01/2026')).toBeFalse();
    expect(cmp.isChecked('15/01/2026')).toBeFalse();
    expect(cmp.isChecked('01/12/2025')).toBeTrue(); // année 2025 intacte
  });

  it('l’état d’un nœud devient « partiel » quand une seule de ses dates est cochée', () => {
    open();
    const y2026 = cmp.dateTree[1];
    cmp.toggleNode(y2026);                 // tout décocher sur 2026
    cmp.toggleValue('02/01/2026');         // n'en recocher qu'une
    expect(cmp.nodeChecked(y2026)).toBeFalse();
    expect(cmp.nodePartial(y2026)).toBeTrue();
  });

  it('déplie/replie un nœud', () => {
    open();
    const y2025 = cmp.dateTree[0];
    const before = cmp.isExpanded(y2025);
    cmp.toggleExpand(y2025, new MouseEvent('click'));
    expect(cmp.isExpanded(y2025)).toBe(!before);
  });

  it('la recherche bascule sur la liste à plat', () => {
    open();
    expect(cmp.isDateMode).toBeTrue();
    cmp.search = '2026';
    expect(cmp.visibleFacets.map(f => f.value)).toEqual(['02/01/2026', '15/01/2026']);
  });

  it('une colonne numérique n’est pas en mode date et s’aligne à droite', () => {
    cmp.type = 'number';
    cmp.field = 'n';
    cmp.format = undefined as any;
    cmp.rows = [{ n: 100 }, { n: 9 }];
    fixture.detectChanges();
    open();
    expect(cmp.isDateMode).toBeFalse();
    expect(cmp.isNumeric).toBeTrue();
    expect(cmp.kindLabel).toBe('Filtres numériques');
  });
});

/**
 * NON-RÉGRESSION : « je recherche une valeur, je clique sur Appliquer, et rien n'est filtré ».
 * Le brouillon contient toutes les valeurs à l'ouverture ; sans restriction aux résultats de la
 * recherche, la validation concluait « tout est retenu » et n'appliquait AUCUN filtre.
 * Comportement attendu (celui d'Excel) : valider après une recherche filtre sur ses résultats.
 */
describe('ColumnFilterComponent (validation après recherche)', () => {
  let fixture: ComponentFixture<ColumnFilterComponent>;
  let cmp: ColumnFilterComponent;
  let emitted: (string[] | null)[];

  function open(): void {
    (fixture.nativeElement.querySelector('.btn-col-filter') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ColumnFilterComponent],
      imports: [FormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(ColumnFilterComponent);
    cmp = fixture.componentInstance;
    cmp.field = 'ville';
    cmp.label = 'Ville';
    cmp.rows = [
      { ville: 'Rabat' }, { ville: 'Casablanca' }, { ville: 'Agadir' }, { ville: 'Salé' },
    ];
    emitted = [];
    cmp.selectedChange.subscribe(v => emitted.push(v));
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.col-filter-menu').forEach(el => el.remove());
  });

  it('rechercher puis Appliquer filtre sur les résultats (sans toucher aux cases)', () => {
    open();
    cmp.search = 'rab';
    cmp.apply();
    expect(emitted[0]).toEqual(['Rabat']);   // et NON null (aucun filtre)
  });

  it('la recherche peut retenir plusieurs valeurs', () => {
    open();
    cmp.search = 'sa';                       // Casablanca + Salé (sous-ensemble STRICT)
    const attendu = cmp.visibleFacets.map(f => f.value);
    expect(attendu.length).toBe(2);
    cmp.apply();
    expect(emitted[0]).toEqual(attendu);
  });

  it('une recherche qui retient TOUTES les valeurs n’enregistre aucun filtre', () => {
    open();
    cmp.search = 'a';                        // les 4 villes contiennent « a »
    expect(cmp.visibleFacets.length).toBe(cmp.facets.length);
    cmp.apply();
    expect(emitted[0]).toBeNull();
  });

  it('les cases décochées parmi les résultats sont exclues', () => {
    open();
    cmp.search = 'sa';
    const resultats = cmp.visibleFacets.map(f => f.value);
    const premier = resultats[0];
    cmp.toggleValue(premier);                // on le décoche
    cmp.apply();                             // apply() réinitialise la recherche : on a capturé avant
    expect(emitted[0]).not.toContain(premier);
    expect(emitted[0]!.length).toBe(resultats.length - 1);
  });

  it('le compteur du pied reflète ce qui sera appliqué', () => {
    open();
    expect(cmp.selectedCount).toBe(4);
    cmp.search = 'rab';
    expect(cmp.selectedCount).toBe(1);
  });

  it('Appliquer est désactivé si aucun résultat de recherche n’est retenu', () => {
    open();
    cmp.search = 'zzz';                      // aucun résultat
    expect(cmp.canApply).toBeFalse();
  });

  it('sans recherche, le comportement d’origine est préservé (tout retenu → aucun filtre)', () => {
    open();
    cmp.apply();
    expect(emitted[0]).toBeNull();
  });

  it('effacer la recherche avant de valider repart de la sélection complète', () => {
    open();
    cmp.search = 'rab';
    cmp.search = '';
    cmp.apply();
    expect(emitted[0]).toBeNull();
  });
});

/** Option « Effacer le filtre de … » dans le menu + espacement de l'entonnoir dans l'en-tête. */
describe('ColumnFilterComponent (effacer le filtre en cours)', () => {
  let fixture: ComponentFixture<ColumnFilterComponent>;
  let cmp: ColumnFilterComponent;

  function open(): void {
    (fixture.nativeElement.querySelector('.btn-col-filter') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  }
  const clearAction = () =>
    document.querySelector('.cf-action-clear') as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ColumnFilterComponent],
      imports: [FormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(ColumnFilterComponent);
    cmp = fixture.componentInstance;
    cmp.field = 'ville';
    cmp.label = 'Ville';
    cmp.rows = [{ ville: 'Rabat' }, { ville: 'Agadir' }];
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.col-filter-menu').forEach(el => el.remove());
  });

  it('l’option n’apparaît PAS quand aucun filtre n’est appliqué', () => {
    open();
    expect(clearAction()).toBeNull();
  });

  it('l’option apparaît quand la colonne est filtrée et nomme la colonne', () => {
    cmp.selected = ['Rabat'];
    fixture.detectChanges();
    open();
    const action = clearAction();
    expect(action).not.toBeNull();
    expect(action!.textContent).toContain('Effacer le filtre');
    expect(action!.textContent).toContain('Ville');
  });

  it('cliquer sur l’option retire le filtre et ferme le menu', () => {
    const emitted: (string[] | null)[] = [];
    cmp.selected = ['Rabat'];
    cmp.selectedChange.subscribe(v => emitted.push(v));
    fixture.detectChanges();
    open();
    clearAction()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emitted[0]).toBeNull();
    expect(cmp.open).toBeFalse();
  });

  it('l’entonnoir est espacé du nom de la colonne dans l’en-tête', () => {
    const marginLeft = getComputedStyle(fixture.nativeElement).marginLeft;
    expect(parseFloat(marginLeft)).toBeGreaterThan(0);
  });
});
