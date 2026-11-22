import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FicheService } from './fiche.service';
import { environment } from '../../../environments/environment';

describe('FicheService', () => {
  let svc: FicheService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/v1/fiche/ssdgps/abc/`;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(FicheService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('appelle fiche/<type>/<id>/ puis sert la fiche depuis le cache', () => {
    let n = 0;
    svc.fiche('ssdgps', 'abc').subscribe(() => n++);
    http.expectOne(url).flush({ titre: 'SDGPS n°1' });
    svc.fiche('ssdgps', 'abc').subscribe(f => { n++; expect(f.titre).toBe('SDGPS n°1'); });
    http.expectNone(url);
    expect(n).toBe(2);
  });

  it("une erreur n'est pas mise en cache ; vider() oublie tout", () => {
    svc.fiche('ssdgps', 'abc').subscribe({ error: () => {} });
    http.expectOne(url).flush({}, { status: 404, statusText: 'Not Found' });
    svc.fiche('ssdgps', 'abc').subscribe();
    http.expectOne(url).flush({ titre: 'x' });
    svc.vider();
    svc.fiche('ssdgps', 'abc').subscribe();
    http.expectOne(url).flush({ titre: 'x' });
  });
});
