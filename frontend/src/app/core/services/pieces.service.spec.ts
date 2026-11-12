import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { PiecesService } from './pieces.service';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/v1/pieces/`;

describe('PiecesService', () => {
  let service: PiecesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PiecesService],
    });
    service = TestBed.inject(PiecesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getCatalog() GET catalog/', () => {
    service.getCatalog().subscribe();
    const req = httpMock.expectOne(`${BASE}catalog/`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getById() GET détail', () => {
    service.getById('7').subscribe();
    const req = httpMock.expectOne(`${BASE}7/`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: '7' });
  });

  it('createManual() POST avec source_saisie=manuel et payload', () => {
    service.createManual({
      type_piece: 'FTR', parent: { ssdgps: 'S1' }, data: { rows: [] },
    }).subscribe();
    const req = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(req.request.body.type_piece).toBe('FTR');
    expect(req.request.body.ssdgps).toBe('S1');
    expect(req.request.body.source_saisie).toBe('manuel');
    expect(req.request.body.payload).toEqual({ rows: [] });
    req.flush({ id: '1' });
  });

  it('uploadImage() POST multipart (FormData, source_saisie=image)', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    service.uploadImage(file, 'RDC', { ssdgps: 'S1' }).subscribe();
    const req = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(req.request.body instanceof FormData).toBeTrue();
    const fd = req.request.body as FormData;
    expect(fd.get('type_piece')).toBe('RDC');
    expect(fd.get('source_saisie')).toBe('image');
    req.flush({ id: '1' });
  });

  it('permanentDelete() DELETE {id}/permanent/', () => {
    service.permanentDelete('7').subscribe();
    const req = httpMock.expectOne(`${BASE}7/permanent/`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('bulkPermanentDelete() POST permanent-delete/ avec ids', () => {
    service.bulkPermanentDelete(['a', 'b']).subscribe();
    const req = httpMock.expectOne(`${BASE}permanent-delete/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ids: ['a', 'b'] });
    req.flush({ deleted_count: 2, errors: [] });
  });

  describe('downloadReport()', () => {
    it('porte sur une session unique quand elle est fournie', () => {
      service.downloadReport('s1', 'sess-2', false).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report/`);
      expect(req.request.params.get('ssdgps')).toBe('s1');
      expect(req.request.params.get('session')).toBe('sess-2');
      expect(req.request.params.get('session_from')).toBeNull();
      req.flush({});
    });

    it('envoie les deux bornes en mode synthèse', () => {
      service.downloadReport('s1', null, true, { from: 'sess-1', to: 'sess-3' }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report/`);
      expect(req.request.params.get('session_from')).toBe('sess-1');
      expect(req.request.params.get('session_to')).toBe('sess-3');
      expect(req.request.params.get('duplex')).toBe('1');
      req.flush({});
    });

    it('n’envoie jamais session ET une plage : le backend les refuse ensemble', () => {
      service.downloadReport('s1', 'sess-2', false, { from: 'sess-1', to: 'sess-3' }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report/`);
      expect(req.request.params.get('session')).toBeNull();
      expect(req.request.params.get('session_from')).toBe('sess-1');
      req.flush({});
    });

    it('omet duplex quand il est faux', () => {
      service.downloadReport('s1').subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report/`);
      expect(req.request.params.get('duplex')).toBeNull();
      req.flush({});
    });
  });

  describe('checkReportCoherence()', () => {
    it('interroge report-check/ pour la portée courante', () => {
      let recu: any;
      service.checkReportCoherence('s1', 'sess-2').subscribe(r => (recu = r));
      const req = httpMock.expectOne(r => r.url === `${BASE}report-check/`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('session')).toBe('sess-2');
      req.flush({ ok: false, total: 1, erreurs: 1, avertissements: 0, anomalies: [] });
      expect(recu.erreurs).toBe(1);
    });

    it('envoie la plage en mode synthèse, sans session', () => {
      service.checkReportCoherence('s1', 'sess-2', { from: 'a', to: 'b' }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report-check/`);
      expect(req.request.params.get('session')).toBeNull();
      expect(req.request.params.get('session_from')).toBe('a');
      req.flush({});
    });
  });

  /**
   * Aperçu de la page de garde : même portée que le rapport, sur un endpoint dédié qui
   * ne rend que cette page — l'opérateur vérifie la liste des pièces avant d'engager
   * plusieurs minutes de rendu.
   */
  describe('previewReportCover()', () => {
    it('porte sur report-cover/ avec la session et le mode choisis', () => {
      service.previewReportCover('s1', 'sess-2', true).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report-cover/`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('ssdgps')).toBe('s1');
      expect(req.request.params.get('session')).toBe('sess-2');
      expect(req.request.params.get('duplex')).toBe('1');
      req.flush({});
    });

    it('envoie la plage en mode synthèse, sans session', () => {
      service.previewReportCover('s1', 'sess-2', false, { from: 'a', to: 'b' }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report-cover/`);
      expect(req.request.params.get('session')).toBeNull();
      expect(req.request.params.get('session_from')).toBe('a');
      expect(req.request.params.get('session_to')).toBe('b');
      req.flush({});
    });
  });

  /**
   * Génération en tâche de fond : la demande rend la main tout de suite, puis l'état
   * est sondé jusqu'au terme. Le rendu dure des dizaines de secondes à plusieurs
   * minutes — en synchrone il immobilisait un worker du serveur et dépassait son délai.
   */
  describe('génération en tâche de fond', () => {
    const RAPPORTS = `${environment.apiUrl}/v1/rapports/`;

    it('startReport() poste sur report-async/ avec les mêmes paramètres', () => {
      service.startReport('s1', 'sess-2', true).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report-async/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.params.get('ssdgps')).toBe('s1');
      expect(req.request.params.get('session')).toBe('sess-2');
      expect(req.request.params.get('duplex')).toBe('1');
      req.flush({});
    });

    it('startReport() envoie la plage en mode synthèse, sans session', () => {
      service.startReport('s1', 'sess-2', false, { from: 'a', to: 'b' }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${BASE}report-async/`);
      expect(req.request.params.get('session')).toBeNull();
      expect(req.request.params.get('session_from')).toBe('a');
      expect(req.request.params.get('session_to')).toBe('b');
      req.flush({});
    });

    it('getReportJob() lit le suivi', () => {
      let recu: any;
      service.getReportJob('job-1').subscribe(j => (recu = j));
      const req = httpMock.expectOne(`${RAPPORTS}job-1/`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'job-1', statut: 'en_cours', progression: 42 });
      expect(recu.progression).toBe(42);
    });

    it('getReportFile() récupère le PDF produit', () => {
      service.getReportFile('job-1').subscribe();
      const req = httpMock.expectOne(`${RAPPORTS}job-1/fichier/`);
      expect(req.request.method).toBe('GET');
      req.flush({ filename: 'r.pdf', content_type: 'application/pdf', data: 'AAA' });
    });

    it('listReportJobs() filtre par SSDGPS', () => {
      service.listReportJobs('s1').subscribe();
      const req = httpMock.expectOne(r => r.url === RAPPORTS);
      expect(req.request.params.get('ssdgps')).toBe('s1');
      req.flush([]);
    });
  });
});
