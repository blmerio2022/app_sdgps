import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { ProjectsService } from './projects.service';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/v1/`;

describe('ProjectsService', () => {
  let service: ProjectsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ProjectsService],
    });
    service = TestBed.inject(ProjectsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getProjets() liste et normalise un tableau', () => {
    let got: any[] | undefined;
    service.getProjets().subscribe(p => (got = p));
    httpMock.expectOne(r => r.url === `${BASE}projets/`).flush([{ id: '1' }]);
    expect(got?.length).toBe(1);
  });

  it('getProjets() normalise une réponse paginée { results }', () => {
    let got: any[] | undefined;
    service.getProjets().subscribe(p => (got = p));
    httpMock.expectOne(r => r.url === `${BASE}projets/`).flush({ results: [{ id: '1' }, { id: '2' }] });
    expect(got?.length).toBe(2);
  });

  it('createProjet() POST', () => {
    service.createProjet({ nom_projet: 'X' } as any).subscribe();
    const req = httpMock.expectOne(`${BASE}projets/`);
    expect(req.request.method).toBe('POST');
    req.flush({ id: '1' });
  });

  it('updateProjet() PATCH', () => {
    service.updateProjet('7', { statut: 'en_cours' } as any).subscribe();
    const req = httpMock.expectOne(`${BASE}projets/7/`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ id: '7' });
  });

  it('restoreProjet() POST {id}/restore/', () => {
    service.restoreProjet('7').subscribe();
    const req = httpMock.expectOne(`${BASE}projets/7/restore/`);
    expect(req.request.method).toBe('POST');
    req.flush({ id: '7' });
  });

  it('bulkRestoreProjets() POST bulk-restore/ avec ids', () => {
    service.bulkRestoreProjets(['a', 'b']).subscribe();
    const req = httpMock.expectOne(`${BASE}projets/bulk-restore/`);
    expect(req.request.body).toEqual({ ids: ['a', 'b'] });
    req.flush({ restored_count: 2 });
  });

  it('permanentDeleteProjet() DELETE {id}/permanent/', () => {
    service.permanentDeleteProjet('7').subscribe();
    const req = httpMock.expectOne(`${BASE}projets/7/permanent/`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('bulkPermanentDeleteProjets() POST permanent-delete/ avec ids', () => {
    service.bulkPermanentDeleteProjets(['a', 'b']).subscribe();
    const req = httpMock.expectOne(`${BASE}projets/permanent-delete/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ids: ['a', 'b'] });
    req.flush({ deleted_count: 2, errors: [] });
  });

  it('permanentDeleteSsdgps() cible la bonne ressource', () => {
    service.permanentDeleteSsdgps('9').subscribe();
    const req = httpMock.expectOne(`${BASE}ssdgps/9/permanent/`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('getProprietes(projetId) filtre par projet', () => {
    service.getProprietes('P1').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}proprietes/`);
    expect(req.request.params.get('projet')).toBe('P1');
    req.flush([]);
  });
  /**
   * Cycle de vie d'un SDGPS : endpoint dédié, et non un PATCH du statut — chaque
   * passage porte ses règles et son contrôle de rôle côté serveur.
   */
  describe('transitionSsdgps()', () => {
    it('poste l’action sur transition/', () => {
      let recu: any;
      service.transitionSsdgps('s1', 'soumettre').subscribe(s => (recu = s));
      const req = httpMock.expectOne(`${BASE}ssdgps/s1/transition/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ action: 'soumettre', motif: '' });
      req.flush({ id: 's1', statut: 'soumis' });
      expect(recu.statut).toBe('soumis');
    });

    it('transmet le motif d’un rejet', () => {
      service.transitionSsdgps('s1', 'rejeter', 'LPA à reprendre.').subscribe();
      const req = httpMock.expectOne(`${BASE}ssdgps/s1/transition/`);
      expect(req.request.body).toEqual({ action: 'rejeter', motif: 'LPA à reprendre.' });
      req.flush({});
    });
  });
});
