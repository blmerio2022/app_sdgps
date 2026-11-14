import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ReseauGpsService } from './reseau-gps.service';
import { environment } from '../../../environments/environment';

describe('ReseauGpsService', () => {
  let service: ReseauGpsService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/v1/reseau-gps/`;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(ReseauGpsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('charge le référentiel', () => {
    service.referentiel().subscribe(r => expect(r.zone_defaut).toBe('nord'));
    const req = http.expectOne(`${base}referentiel/`);
    expect(req.request.method).toBe('GET');
    req.flush({ zone_defaut: 'nord' });
  });

  it('envoie la demande de génération en POST', () => {
    const demande = {
      points: [{ nom_point: 'A', x_m: 1, y_m: 2 }], type_reseau: 'anciens' as const,
      zone: 'nord', longueur_max_km: 10, nb_suggestions_max: 5,
    };
    service.generer(demande).subscribe(r => expect(r.recommandee).toBe('delaunay'));
    const req = http.expectOne(`${base}generer/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(demande);
    req.flush({ recommandee: 'delaunay' });
  });

  it('liste les LPA puis reprend celle d\'un SDGPS', () => {
    service.sourcesLpa().subscribe(l => expect(l.length).toBe(1));
    http.expectOne(`${base}sources-lpa/`).flush([{ ssdgps_id: 'x' }]);
    service.sourceLpa('abc').subscribe(d => expect(d.zone_proposee).toBe('sud'));
    http.expectOne(`${base}sources-lpa/abc/`).flush({ points: [], zone_proposee: 'sud' });
  });
});

describe('ReseauGpsService — écarts et densification', () => {
  let service: ReseauGpsService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/v1/reseau-gps/`;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(ReseauGpsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('analyse les écarts', () => {
    service.analyserEcarts([{ nom_point_fixe: 'A', nom_point_calcule: 'B' }], 0.15, ['A']).subscribe();
    const req = http.expectOne(`${base}analyser-ecarts/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.tolerance_m).toBe(0.15);
    expect(req.request.body.noms_reseau).toEqual(['A']);
    req.flush({});
  });

  it('liste et reprend les rapports de contrôle', () => {
    service.sourcesRc().subscribe();
    http.expectOne(`${base}sources-rc/`).flush([]);
    service.sourceRc('x').subscribe();
    http.expectOne(`${base}sources-rc/x/`).flush({ lignes: [] });
  });

  it('densifie', () => {
    service.densifier({ anciens: [], nouveaux: [], nb_nouveaux: 0, proposer: true, zone: 'nord',
      longueur_max_km: 10, rayon_couverture_km: 5, points_couverture_min: 3 }).subscribe();
    const req = http.expectOne(`${base}densifier/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.rayon_couverture_km).toBe(5);
    req.flush({});
  });
});
