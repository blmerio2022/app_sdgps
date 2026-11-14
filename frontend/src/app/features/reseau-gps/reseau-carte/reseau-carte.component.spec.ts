import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import {
  ReseauCarteComponent, VueCarte, echapper, popupLigne, popupPoint, popupTriangle,
} from './reseau-carte.component';
import { PointResultat } from '../../../core/services/reseau-gps.service';

const POINTS: PointResultat[] = [
  { index: 0, nom_point: 'A<1>', x_m: 420000, y_m: 380000, lat: 34.01, lon: -6.26, degre: 2, statut: 'ancien',
    reference: 'R1', nature_materialisation: 'Borne', nature_signalisation: 'Peinture' },
  { index: 1, nom_point: 'B', x_m: 422000, y_m: 380000, lat: 34.01, lon: -6.24, degre: 2, statut: 'nouveau' },
  { index: 2, nom_point: 'S1', x_m: 421000, y_m: 381700, lat: 34.03, lon: -6.25, degre: 2, statut: 'suggere' },
];

const VUE: VueCarte = {
  points: POINTS,
  lignes: [
    { de: 0, a: 1, distance_m: 2000, distance_km: 2, azimut_deg: 90, en_boucle: true, trop_longue: false },
    { de: 1, a: 2, distance_m: 1972, distance_km: 1.972, azimut_deg: 330, en_boucle: true, trop_longue: false },
    { de: 0, a: 2, distance_m: 1972, distance_km: 1.972, azimut_deg: 30, en_boucle: true, trop_longue: true },
  ],
  triangles: [{ sommets: [0, 1, 2], angles_deg: [59.5, 59.5, 61], angle_min: 59.5, angle_max: 61, conforme: true, defectueux: false }],
  suggestions: [{ index: 2, nom_point: 'S1', x_m: 421000, y_m: 381700, lat: 34.03, lon: -6.25,
    rayon_recherche_m: 300, motif: 'm', score_avant: 50, score_apres: 60, justification: 'Parce que' }],
};

describe('ReseauCarteComponent', () => {
  let fixture: ComponentFixture<ReseauCarteComponent>;
  let comp: ReseauCarteComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [ReseauCarteComponent] });
    fixture = TestBed.createComponent(ReseauCarteComponent);
    comp = fixture.componentInstance;
    // Pas de fond : aucune tuile n'est téléchargée pendant les tests.
    comp.fond = null;
    fixture.nativeElement.style.height = '400px';
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('crée la carte Leaflet', () => {
    expect(comp.carte).toBeTruthy();
    expect(comp.coucheFond).toBeNull();
  });

  it('dessine triangles, lignes, cercle de recherche et points', () => {
    comp.vue = VUE;
    comp.ngOnChanges({ vue: new SimpleChange(null, VUE, false) });
    // 1 triangle + 3 lignes + 1 cercle + 3 points
    expect(comp.coucheReseau!.getLayers().length).toBe(8);
  });

  it('masque les triangles à la demande', () => {
    comp.vue = VUE;
    comp.afficherTriangles = false;
    comp.ngOnChanges({ vue: new SimpleChange(null, VUE, false) });
    expect(comp.coucheReseau!.getLayers().length).toBe(7);
  });

  it('ajoute puis retire un fond de carte', () => {
    comp.fond = { id: 'x', nom: 'X', type: 'xyz', url: 'data:,{z}{x}{y}' };
    comp.ngOnChanges({ fond: new SimpleChange(null, comp.fond, false) });
    expect(comp.coucheFond).toBeTruthy();
    comp.fond = null;
    comp.ngOnChanges({ fond: new SimpleChange(null, null, false) });
    expect(comp.coucheFond).toBeNull();
  });

  it('les popups portent les informations LPA et sont échappées', () => {
    const html = popupPoint(POINTS[0]);
    expect(html).toContain('A&lt;1&gt;');
    expect(html).toContain('Borne');
    expect(html).toContain('Peinture');
    expect(html).toContain('R1');
    expect(popupLigne(VUE.lignes[0], POINTS)).toContain('km');
    expect(popupLigne(VUE.lignes[2], POINTS)).toContain('Trop longue');
    expect(popupTriangle(VUE.triangles[0], POINTS)).toContain('Conforme');
    expect(echapper('<script>')).toBe('&lt;script&gt;');
  });
});
