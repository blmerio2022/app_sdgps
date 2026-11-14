import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { ReseauGpsService, VarianteReseau } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReseauGpsStore } from '../reseau-gps.store';
import { RgSectionComponent } from '../rg-section/rg-section.component';
import { COMPARAISON, OngletControleComponent } from './onglet-controle.component';
import { OngletDensificationComponent } from './onglet-densification.component';
import { OngletEcartsComponent } from './onglet-ecarts.component';
import { OngletFondsComponent } from './onglet-fonds.component';
import { OngletPointsComponent } from './onglet-points.component';

function variante(code: string, score: number, lignes: number): VarianteReseau {
  return { code, nom: code, indicateurs: { score, nb_lignes_base: lignes } } as unknown as VarianteReseau;
}

describe('Onglets du module Réseau GPS', () => {
  let service: jasmine.SpyObj<ReseauGpsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let store: ReseauGpsStore;

  beforeEach(() => {
    service = jasmine.createSpyObj('ReseauGpsService',
      ['referentiel', 'sourcesLpa', 'sourceLpa', 'sourcesRc', 'sourceRc', 'analyserEcarts', 'densifier', 'generer']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    store = new ReseauGpsStore(service, toast);
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [OngletPointsComponent, OngletControleComponent, OngletEcartsComponent,
        OngletDensificationComponent, OngletFondsComponent, RgSectionComponent],
      providers: [{ provide: ReseauGpsService, useValue: service }, { provide: ToastService, useValue: toast },
        { provide: ReseauGpsStore, useValue: store }],
      schemas: [NO_ERRORS_SCHEMA],
    });
  });

  function creer<T>(type: new (...a: any[]) => T): ComponentFixture<T> {
    const f = TestBed.createComponent(type);
    f.detectChanges();
    return f;
  }

  it('Points : reprend une LPA et sa zone proposée', () => {
    service.sourcesLpa.and.returnValue(of([{ ssdgps_id: 's', piece_id: 'p', libelle: 'L', nature_ssdgps: 'PDC/GPS', nb_points: 1 }]));
    service.sourceLpa.and.returnValue(of({ ssdgps_id: 's', libelle: 'SDGPS 1', nature_ssdgps: 'PDC/GPS', zone_proposee: 'sud',
      points: [{ nom_point: 'B1', x_m: 1, y_m: 2 }] }));
    const c = creer(OngletPointsComponent).componentInstance;
    c.choisirSource('lpa');
    expect(c.sourcesLpa.length).toBe(1);
    c.ssdgpsChoisi = 's';
    c.chargerLpa();
    expect(store.anciens.length).toBe(1);
    expect(store.zone).toBe('sud');
    expect(store.libelleSource).toBe('SDGPS 1');
  });

  it('Points : affiche la liste et permet d\'écarter un point', () => {
    store.definirAnciens([{ nom_point: 'A', x_m: 1, y_m: 1 }], '');
    const f = creer(OngletPointsComponent);
    const caseRetenu: HTMLInputElement = f.nativeElement.querySelector('tbody input[type=checkbox]');
    caseRetenu.click();
    expect(store.anciens[0].retenu).toBeFalse();
  });

  it('Contrôle : repère la meilleure valeur de chaque indicateur', () => {
    const c = creer(OngletControleComponent).componentInstance;
    store.controle = {
      variantes: [variante('a', 60, 10), variante('b', 80, 12)], recommandee: 'b',
      parfaite: variante('parfaite', 90, 15), suppressions: [], justification: [],
    } as any;
    const score = COMPARAISON[0];
    expect(c.estMeilleure(score, store.controle!.parfaite)).toBeTrue();
    expect(c.estMeilleure(score, store.controle!.variantes[0])).toBeFalse();
    expect(c.toutesVariantes.length).toBe(3);
    expect(c.scoreRecommande).toBe(80);
  });

  it('Écarts : reprend la pièce RC d\'un SDGPS et lance l\'analyse', () => {
    service.sourcesRc.and.returnValue(of([]));
    service.sourceRc.and.returnValue(of({ ssdgps_id: 's', libelle: 'RC 1', lignes: [{ nom_point_fixe: 'A', nom_point_calcule: 'B' }] }));
    service.analyserEcarts.and.returnValue(of({ homogenes: [], points: [], lignes: [] } as any));
    const c = creer(OngletEcartsComponent).componentInstance;
    c.choisirSource('piece');
    c.ssdgpsChoisi = 's';
    c.chargerPiece();
    expect(store.libelleRc).toBe('RC 1');
    expect(service.analyserEcarts).toHaveBeenCalled();
    expect(c.analysePoint('Z')).toBeNull();
  });

  it('Densification : bascule le placement sur la carte', () => {
    const c = creer(OngletDensificationComponent).componentInstance;
    c.basculerModeAjout();
    expect(store.modeAjoutCarte).toBeTrue();
  });

  it('Fonds : valide puis enregistre un fond personnalisé', () => {
    store.referentiel = { fonds: { categories: [], catalogue: [
      { id: 'osm', categorie: 'cartographique' }, { id: 'esri', categorie: 'satellitaire' }] } } as any;
    const c = creer(OngletFondsComponent).componentInstance;
    expect(c.catalogueDe('satellitaire').map(f => f.id)).toEqual(['esri']);
    c.nouveau = { nom: 'X', type: 'xyz', url: 'https://t/tuile.png', couches: '', attribution: '' };
    c.ajouterPersonnel();
    expect(c.erreur).toContain('{z}');
    spyOn(store, 'ajouterFondPersonnel').and.callThrough();
    c.nouveau = { nom: 'X', type: 'xyz', url: 'https://t/{z}/{x}/{y}.png', couches: '', attribution: '' };
    c.ajouterPersonnel();
    expect(c.erreur).toBe('');
    expect(store.ajouterFondPersonnel).toHaveBeenCalled();
    expect(c.nouveau.nom).toBe('');
    localStorage.removeItem('reseauGps.mesFonds');
  });
});

describe('RgSectionComponent', () => {
  beforeEach(() => localStorage.removeItem('reseauGps.sections'));
  afterEach(() => localStorage.removeItem('reseauGps.sections'));

  it('se replie, se déplie et mémorise son état', () => {
    TestBed.configureTestingModule({ declarations: [RgSectionComponent] });
    const f = TestBed.createComponent(RgSectionComponent);
    f.componentInstance.cle = 'test.section';
    f.componentInstance.titre = 'Titre';
    f.detectChanges();
    expect(f.nativeElement.querySelector('.rg-section-corps')).toBeTruthy();
    f.nativeElement.querySelector('.rg-section-tete').click();
    f.detectChanges();
    expect(f.componentInstance.ouvert).toBeFalse();
    expect(f.nativeElement.querySelector('.rg-section-corps')).toBeNull();
    expect(RgSectionComponent.lireEtats()['test.section']).toBeFalse();

    const g = TestBed.createComponent(RgSectionComponent);
    g.componentInstance.cle = 'test.section';
    g.detectChanges();
    expect(g.componentInstance.ouvert).toBeFalse();
  });
});
