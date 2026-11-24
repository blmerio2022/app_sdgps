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

  it('suit le workflow : points, zone d’étude, contrôle de stabilité, écarts (facultatif), points nouveaux', () => {
    const titres = Array.from(fixture.nativeElement.querySelectorAll('.rg-onglet-titre'))
      .map((e: any) => e.textContent.trim());
    expect(titres).toEqual(['Points anciens', 'Zone d’étude', 'Contrôle de stabilité', 'Écarts (facultatif)',
      'Points nouveaux', 'Fonds de carte']);
  });

  it('titre GNSS, plein écran (Échap pour quitter) et mode de clic transmis à la carte', () => {
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Réseau de triangulation GNSS');
    comp.basculerPleinEcran();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rg-zone-carte').classList).toContain('plein-ecran');
    comp.quitterPleinEcran();
    expect(comp.pleinEcran).toBeFalse();
    expect(comp.outilCarte).toBe('aucun');
    store.commencerDessinZone();
    expect(comp.outilCarte).toBe('dessin');
    comp.pleinEcran = true;
    comp.quitterPleinEcran();
    expect(comp.pleinEcran).toBeTrue();          // Échap annule d'abord le tracé
    store.arreterModesCarte();
    store.editionLignes = 'controle';
    expect(comp.outilCarte).toBe('lignes');
    expect(comp.resume('zones')).toBe('À dessiner ou importer');
  });

  it('change d\'onglet au clic', () => {
    const boutons = fixture.nativeElement.querySelectorAll('.rg-onglet');
    boutons[3].click();
    expect(store.onglet).toBe('ecarts');
    expect(comp.legende).toContain('homogene');
  });

  it('résume l\'avancement et marque les étapes terminées', () => {
    expect(comp.resume('points')).toBe('À importer');
    expect(comp.termine('points')).toBeFalse();
    store.definirAnciens([{ nom_point: 'A', x_m: 1, y_m: 1 }, { nom_point: 'B', x_m: 2, y_m: 1 },
      { nom_point: 'C', x_m: 1, y_m: 2 }], '');
    expect(comp.resume('points')).toBe('3 actif(s)');
    expect(comp.termine('points')).toBeTrue();
    expect(comp.resume('controle')).toBe('À générer');
    expect(comp.resume('ecarts')).toBe('RC à importer');
    store.ajouterZoneDessinee([[34, -6.3], [34, -6.2], [34.05, -6.2]]);
    expect(comp.resume('zones')).toBe('Zone 1');                  // désignée zone d'étude d'office
    expect(comp.termine('zones')).toBeTrue();
    store.anciens.forEach(a => store.qualifier(a, 'homogene'));
    store.validerGroupeHomogene();
    expect(comp.resume('controle')).toBe('Groupe de 3 validé');
    expect(comp.termine('controle')).toBeTrue();
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
