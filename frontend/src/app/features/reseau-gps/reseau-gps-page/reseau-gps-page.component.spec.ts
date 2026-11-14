import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, EventEmitter, Input, NO_ERRORS_SCHEMA, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { ReseauGpsPageComponent } from './reseau-gps-page.component';
import { ReseauGpsService } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReseauGpsStore } from '../reseau-gps.store';

@Component({ selector: 'app-reseau-carte', template: '' })
class CarteFactice {
  @Input() vue: any; @Input() fond: any; @Input() etiquettesDistances: any; @Input() afficherTriangles: any;
  @Input() modeAjout: any; @Output() clicCarte = new EventEmitter<any>();
  recadrer() {}
}

describe('ReseauGpsPageComponent', () => {
  let fixture: ComponentFixture<ReseauGpsPageComponent>;
  let comp: ReseauGpsPageComponent;
  let store: ReseauGpsStore;

  beforeEach(() => {
    const service = jasmine.createSpyObj('ReseauGpsService', ['referentiel']);
    service.referentiel.and.returnValue(of({
      zones: [], zone_defaut: 'nord', types_reseau: [], variantes: [], normes: [],
      fonds: { categories: [], catalogue: [], par_defaut: [], aide_personnalise: [] },
      defauts: { longueur_max_km: 10, nb_suggestions_max: 5, points_max: 300, suggestions_max: 15,
        tolerance_rc_m: 0.15, rayon_couverture_km: 5, points_couverture_min: 3, nouveaux_max: 50 },
    }));
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ReseauGpsPageComponent, CarteFactice],
      providers: [{ provide: ReseauGpsService, useValue: service },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(ReseauGpsPageComponent);
    comp = fixture.componentInstance;
    store = comp.store;
    fixture.detectChanges();
  });

  it('affiche les 4 étapes dans l\'ordre du travail, puis les fonds de carte', () => {
    const titres = Array.from(fixture.nativeElement.querySelectorAll('.rg-onglet-titre'))
      .map((e: any) => e.textContent.trim());
    expect(titres).toEqual(['Points anciens', 'Réseau de contrôle', 'Contrôle des écarts', 'Densification', 'Fonds de carte']);
  });

  it('change d\'onglet au clic', () => {
    const boutons = fixture.nativeElement.querySelectorAll('.rg-onglet');
    boutons[2].click();
    expect(store.onglet).toBe('ecarts');
    expect(comp.legende).toContain('homogene');
  });

  it('résume l\'avancement et marque les étapes terminées', () => {
    expect(comp.resume('points')).toBe('À importer');
    expect(comp.termine('points')).toBeFalse();
    store.definirAnciens([{ nom_point: 'A', x_m: 1, y_m: 1 }, { nom_point: 'B', x_m: 2, y_m: 1 },
      { nom_point: 'C', x_m: 1, y_m: 2 }], '');
    expect(comp.resume('points')).toBe('3 retenu(s)');
    expect(comp.termine('points')).toBeTrue();
    expect(comp.resume('controle')).toBe('À calculer');
    expect(comp.resume('ecarts')).toBe('RC à importer');
  });

  it('transmet un clic de carte au store uniquement en mode placement', () => {
    spyOn(store, 'ajouterNouveauDepuisCarte');
    comp.clicCarte({ lat: 34, lon: -6 });
    expect(store.ajouterNouveauDepuisCarte).not.toHaveBeenCalled();
    store.modeAjoutCarte = true;
    comp.clicCarte({ lat: 34, lon: -6 });
    expect(store.ajouterNouveauDepuisCarte).toHaveBeenCalledWith(34, -6);
  });
});
