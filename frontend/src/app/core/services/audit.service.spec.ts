import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { AuditService } from './audit.service';
import { environment } from '../../../environments/environment';

const URL = `${environment.apiUrl}/v1/audit-events/`;

describe('AuditService', () => {
  let service: AuditService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(AuditService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('evenements() pagine et n’envoie que les filtres renseignés', () => {
    service.evenements({ q: ' zaytoun ', action: undefined, cible_type: '', ordre: 'asc' }, 2, 100).subscribe();
    const req = http.expectOne(r => r.url === URL);
    expect(req.request.params.get('q')).toBe('zaytoun');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('page_size')).toBe('100');
    expect(req.request.params.get('ordre')).toBe('asc');
    expect(req.request.params.has('action')).toBeFalse();
    expect(req.request.params.has('cible_type')).toBeFalse();
    req.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('synthese(), options(), exporter()', () => {
    service.synthese({ depuis: '2026-11-01' }).subscribe();
    expect(http.expectOne(r => r.url === `${URL}synthese/`).request.params.get('depuis')).toBe('2026-11-01');
    service.options().subscribe();
    http.expectOne(`${URL}filtres/`).flush({ actions: [], types_cible: [] });
    service.exporter({ action: 'LOGIN_FAILED' }).subscribe();
    const exp = http.expectOne(r => r.url === `${URL}export/`);
    expect(exp.request.responseType).toBe('blob');
    expect(exp.request.params.get('action')).toBe('LOGIN_FAILED');
    exp.flush(new Blob(['x']));
  });
});
