import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { OrganismeSortConfigService } from './organisme-sort-config.service';
import { environment } from '../../../environments/environment';

const url = (niveau: number) => `${environment.apiUrl}/auth/me/organisme-sort-config/${niveau}/`;

describe('OrganismeSortConfigService', () => {
  let service: OrganismeSortConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [OrganismeSortConfigService],
    });
    service = TestBed.inject(OrganismeSortConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('get(niveau) met en cache par niveau (un seul appel HTTP par niveau)', () => {
    service.get(1).subscribe();
    service.get(1).subscribe();
    httpMock.expectOne(url(1)).flush([]);
  });

  it('get(1) et get(2) frappent des URLs distinctes', () => {
    service.get(1).subscribe();
    service.get(2).subscribe();
    httpMock.expectOne(url(1)).flush([]);
    httpMock.expectOne(url(2)).flush([]);
  });

  it('get() normalise (filtre les niveaux sans champ, sens défaut asc)', () => {
    let got: any;
    service.get(1).subscribe(v => (got = v));
    httpMock.expectOne(url(1)).flush([{ field: 'nom', dir: 'desc' }, { dir: 'asc' }, { field: 'code' }]);
    expect(got).toEqual([{ field: 'nom', dir: 'desc' }, { field: 'code', dir: 'asc' }]);
  });

  it('save() PUT sur l\'URL du niveau', () => {
    service.save(2, [{ field: 'ville', dir: 'asc' }]).subscribe();
    const req = httpMock.expectOne(url(2));
    expect(req.request.method).toBe('PUT');
    req.flush([]);
  });

  it('resetToSource() POST reset/', () => {
    service.resetToSource(1).subscribe();
    const req = httpMock.expectOne(`${url(1)}reset/`);
    expect(req.request.method).toBe('POST');
    req.flush([]);
  });
});
