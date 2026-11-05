import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { OrgSortConfigService } from './org-sort-config.service';
import { environment } from '../../../environments/environment';

const URL = `${environment.apiUrl}/auth/me/org-sort-config/`;

describe('OrgSortConfigService', () => {
  let service: OrgSortConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [OrgSortConfigService],
    });
    service = TestBed.inject(OrgSortConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('get() met en cache (un seul appel HTTP)', () => {
    service.get().subscribe();
    service.get().subscribe();
    httpMock.expectOne(URL).flush([]);
  });

  it('get() normalise (filtre les niveaux sans champ, sens défaut asc)', () => {
    let got: any;
    service.get().subscribe(v => (got = v));
    httpMock.expectOne(URL).flush([{ field: 'name', dir: 'desc' }, { dir: 'asc' }, { field: 'code' }]);
    expect(got).toEqual([{ field: 'name', dir: 'desc' }, { field: 'code', dir: 'asc' }]);
  });

  it('save() PUT', () => {
    service.save([{ field: 'name', dir: 'asc' }]).subscribe();
    const req = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    req.flush([]);
  });

  it('resetToSource() POST reset/', () => {
    service.resetToSource().subscribe();
    const req = httpMock.expectOne(`${URL}reset/`);
    expect(req.request.method).toBe('POST');
    req.flush([]);
  });
});
