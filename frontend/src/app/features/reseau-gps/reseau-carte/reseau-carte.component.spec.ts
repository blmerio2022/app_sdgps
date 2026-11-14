import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import {
  PointCarte, ReseauCarteComponent, VueCarte, echapper, popupLigne, popupPoint, popupTriangle,
} from './reseau-carte.component';

const POINTS: PointCarte[] = [
  { nom_point: 'A<1>', x_m: 420000, y_m: 380000, lat: 34.01, lon: -6.26, degre: 2, style: 'ancien',
    reference: 'R1', nature_materialisation: 'Borne', nature_signalisation: 'Peinture', marque: true, note: 'Doublon' },
  { nom_point: 'B', x_m: 422000, y_m: 380000, lat: 34.01, lon: -6.24, degre: 2, style: 'propose' },
  { nom_point: 'S1', x_m: 421000, y_m: 381700, lat: 34.03, lon: -6.25, degre: 2, style: 'suggere' },
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
  zone: [[34.0, -6.27], [34.0, -6.23], [34.04, -6.25]],
  nonCouverts: [[34.02, -6.25], [34.021, -6.251]],
};

describe('ReseauCarteComponent', () => {
  let fixture: ComponentFixture<ReseauCarteComponent>;
  let comp: ReseauCarteComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [ReseauCarteComponent] });
    fixture = TestBed.createComponent(ReseauCarteComponent);
    comp = fixture.componentInstance;
    comp.fond = null; // aucune tuile téléchargée pendant les tests
    fixture.nativeElement.style.height = '400px';
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function afficher(v: VueCarte) {
    comp.vue = v;
    comp.ngOnChanges({ vue: new SimpleChange(null, v, false) });
  }

  it('crée la carte Leaflet sans fond', () => {
    expect(comp.carte).toBeTruthy();
    expect(comp.coucheFond).toBeNull();
  });

  it('dessine zone, non-couverts, triangles, lignes, cercles et points (+ marque)', () => {
    afficher(VUE);
    // zone 1 + non couverts 2 + triangle 1 + lignes 3 + cercle 1 + marque 1 + points 3
    expect(comp.coucheReseau!.getLayers().length).toBe(12);
  });

  it('masque les triangles à la demande', () => {
    comp.afficherTriangles = false;
    afficher(VUE);
    expect(comp.coucheReseau!.getLayers().length).toBe(11);
  });

  it('émet le clic seulement en mode ajout', () => {
    const recus: any[] = [];
    comp.clicCarte.subscribe(e => recus.push(e));
    comp.carte!.fire('click', { latlng: { lat: 34, lng: -6 } });
    expect(recus.length).toBe(0);
    comp.modeAjout = true;
    comp.carte!.fire('click', { latlng: { lat: 34, lng: -6 } });
    expect(recus).toEqual([{ lat: 34, lon: -6 }]);
  });

  it('ajoute puis retire un fond de carte (XYZ et WMS)', () => {
    comp.fond = { id: 'x', nom: 'X', type: 'xyz', url: 'data:,{z}{x}{y}' };
    comp.ngOnChanges({ fond: new SimpleChange(null, comp.fond, false) });
    expect(comp.coucheFond).toBeTruthy();
    comp.fond = { id: 'w', nom: 'W', type: 'wms', url: 'data:,', couches: 'L' };
    comp.ngOnChanges({ fond: new SimpleChange(null, comp.fond, false) });
    expect(comp.coucheFond).toBeTruthy();
    comp.fond = null;
    comp.ngOnChanges({ fond: new SimpleChange(null, null, false) });
    expect(comp.coucheFond).toBeNull();
  });

  it('les popups portent les informations LPA, sont échappées et décrivent les écarts', () => {
    const html = popupPoint(POINTS[0]);
    expect(html).toContain('A&lt;1&gt;');
    expect(html).toContain('Borne');
    expect(html).toContain('Peinture');
    expect(html).toContain('Doublon');
    expect(popupLigne(VUE.lignes[0], POINTS)).toContain('km');
    expect(popupLigne(VUE.lignes[2], POINTS)).toContain('Trop longue');
    expect(popupLigne({ ...VUE.lignes[0], style: 'incompatible', ecart_m: 0.25 }, POINTS)).toContain('ΔD');
    expect(popupTriangle(VUE.triangles[0], POINTS)).toContain('Conforme');
    expect(echapper('<script>')).toBe('&lt;script&gt;');
  });
});
