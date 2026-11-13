import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { ModelesSsdgpsService } from './modeles-ssdgps.service';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/v1/`;
const URL = `${BASE}modeles-ssdgps/`;

describe('ModelesSsdgpsService', () => {
  let service: ModelesSsdgpsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule], providers: [ModelesSsdgpsService] });
    service = TestBed.inject(ModelesSsdgpsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() filtre par nature et normalise une réponse paginée', () => {
    let got: any[] | undefined;
    service.list('PDC/GPS').subscribe(l => (got = l));
    const req = http.expectOne(r => r.url === URL);
    expect(req.request.params.get('nature')).toBe('PDC/GPS');
    req.flush({ results: [{ id: 'm1' }, { id: 'm2' }] });
    expect(got?.length).toBe(2);
  });

  it('list() sans nature n’envoie pas le filtre', () => {
    service.list().subscribe();
    const req = http.expectOne(r => r.url === URL);
    expect(req.request.params.has('nature')).toBeFalse();
    req.flush([]);
  });

  it('create / update / delete', () => {
    service.create({ nom: 'A' }).subscribe();
    expect(http.expectOne(URL).request.method).toBe('POST');
    service.update('m1', { nom: 'B' }).subscribe();
    expect(http.expectOne(`${URL}m1/`).request.method).toBe('PATCH');
    service.delete('m1').subscribe();
    expect(http.expectOne(`${URL}m1/`).request.method).toBe('DELETE');
  });

  it('duplicate() POST sur /dupliquer/ avec le nom', () => {
    service.duplicate('m1', 'Copie').subscribe();
    const req = http.expectOne(`${URL}m1/dupliquer/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ nom: 'Copie' });
  });

  it('fromSsdgps() enregistre un dossier comme modèle', () => {
    service.fromSsdgps('s1', 'Depuis dossier').subscribe();
    const req = http.expectOne(`${URL}depuis-ssdgps/`);
    expect(req.request.body).toEqual({ ssdgps: 's1', nom: 'Depuis dossier', description: '' });
  });

  it('createDossier() POST la chaîne complète sur /ssdgps/assistant/', () => {
    const payload: any = { projet: { id: 'p' }, propriete: { id: 'pr' }, affaire: { id: 'a' }, ssdgps: {}, modele: 'm1' };
    service.createDossier(payload).subscribe();
    const req = http.expectOne(`${BASE}ssdgps/assistant/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
  });

  it('getPlan / applyModele / validatePieces', () => {
    service.getPlan('s1').subscribe();
    expect(http.expectOne(`${BASE}ssdgps/s1/plan/`).request.method).toBe('GET');
    service.applyModele('s1', 'm1').subscribe();
    expect(http.expectOne(`${BASE}ssdgps/s1/appliquer-modele/`).request.body).toEqual({ modele: 'm1' });
    service.validatePieces('s1').subscribe();
    expect(http.expectOne(`${BASE}ssdgps/s1/valider-pieces/`).request.body).toEqual({});
    service.validatePieces('s1', ['x']).subscribe();
    expect(http.expectOne(`${BASE}ssdgps/s1/valider-pieces/`).request.body).toEqual({ ids: ['x'] });
  });
});
