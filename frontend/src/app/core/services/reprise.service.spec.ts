import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { RepriseService, ilYa } from './reprise.service';

describe('RepriseService', () => {
  let svc: RepriseService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(RepriseService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lit les travaux en cours avec la limite demandée', () => {
    let total = -1;
    svc.travaux(30).subscribe(r => total = r.total);
    const req = http.expectOne(r => r.url === `${environment.apiUrl}/v1/reprise/`);
    expect(req.request.params.get('limite')).toBe('30');
    req.flush({ total: 3, resultats: [] });
    expect(total).toBe(3);
  });
});

describe('ilYa', () => {
  const maintenant = new Date('2026-11-18T12:00:00Z');
  const avant = (secondes: number) => new Date(maintenant.getTime() - secondes * 1000).toISOString();

  it('formule une durée relative en français', () => {
    expect(ilYa(avant(20), maintenant)).toBe('à l’instant');
    expect(ilYa(avant(5 * 60), maintenant)).toBe('il y a 5 min');
    expect(ilYa(avant(3 * 3600), maintenant)).toBe('il y a 3 h');
    expect(ilYa(avant(26 * 3600), maintenant)).toBe('hier');
    expect(ilYa(avant(4 * 86400), maintenant)).toBe('il y a 4 j');
    expect(ilYa(avant(90 * 86400), maintenant)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
