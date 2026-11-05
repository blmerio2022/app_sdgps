import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { TableColumnsConfigService } from './table-columns-config.service';
import { environment } from '../../../environments/environment';

const url = (key: string) => `${environment.apiUrl}/auth/me/table-columns-config/${key}/`;

describe('TableColumnsConfigService', () => {
  let service: TableColumnsConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TableColumnsConfigService],
    });
    service = TestBed.inject(TableColumnsConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('get(key) met en cache par clé (un seul appel HTTP par clé)', () => {
    service.get('users').subscribe();
    service.get('users').subscribe();
    httpMock.expectOne(url('users')).flush([]);
  });

  it('get() de clés distinctes frappe des URLs distinctes', () => {
    service.get('users').subscribe();
    service.get('projects').subscribe();
    httpMock.expectOne(url('users')).flush([]);
    httpMock.expectOne(url('projects')).flush([]);
  });

  it('get() normalise (filtre les entrées sans champ, visible en booléen)', () => {
    let got: any;
    service.get('users').subscribe(v => (got = v));
    httpMock.expectOne(url('users')).flush([{ field: 'email', visible: 1 }, { visible: true }, { field: 'role' }]);
    expect(got).toEqual([{ field: 'email', visible: true }, { field: 'role', visible: false }]);
  });

  it('get() renvoie [] en cas d\'erreur HTTP', () => {
    let got: any;
    service.get('users').subscribe(v => (got = v));
    httpMock.expectOne(url('users')).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(got).toEqual([]);
  });

  it('save() PUT sur l\'URL de la clé et met le cache à jour', () => {
    service.save('projects', [{ field: 'nom_projet', visible: false }]).subscribe();
    const req = httpMock.expectOne(url('projects'));
    expect(req.request.method).toBe('PUT');
    req.flush([{ field: 'nom_projet', visible: false }]);
    // Lecture ultérieure servie depuis le cache (pas de nouvel appel HTTP).
    service.get('projects').subscribe();
    httpMock.verify();
  });

  it('resetToSource() POST reset/', () => {
    service.resetToSource('users').subscribe();
    const req = httpMock.expectOne(`${url('users')}reset/`);
    expect(req.request.method).toBe('POST');
    req.flush([]);
  });
});
