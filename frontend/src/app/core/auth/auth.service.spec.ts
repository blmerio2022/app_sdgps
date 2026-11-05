import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

/** Fabrique un JWT factice (header.payload.signature) au payload donné. */
function makeJwt(payload: object): string {
  return `x.${btoa(JSON.stringify(payload))}.y`;
}

const API = `${environment.apiUrl}/auth`;

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('isLoggedIn/getAuthToken reflètent le localStorage', () => {
    expect(service.isLoggedIn()).toBeFalse();
    localStorage.setItem('authToken', 'tok');
    expect(service.isLoggedIn()).toBeTrue();
    expect(service.getAuthToken()).toBe('tok');
  });

  it('logout() purge les tokens et l’état de connexion', () => {
    localStorage.setItem('authToken', 'tok');
    localStorage.setItem('refreshToken', 'ref');
    let emitted: boolean | undefined;
    service.isAuthenticated$.subscribe(v => (emitted = v));

    service.logout();

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(service.isLoggedIn()).toBeFalse();
    expect(emitted).toBeFalse(); // dernière valeur émise après logout
  });

  it('isPlatformAdmin() décode le JWT (platform_role / is_superuser)', () => {
    localStorage.setItem('authToken', makeJwt({ platform_role: 'ROLE_ADMIN_SYSTEME' }));
    expect(service.isPlatformAdmin()).toBeTrue();

    localStorage.setItem('authToken', makeJwt({ is_superuser: true }));
    expect(service.isPlatformAdmin()).toBeTrue();

    localStorage.setItem('authToken', makeJwt({ role: 'AGENT' }));
    expect(service.isPlatformAdmin()).toBeFalse();

    localStorage.removeItem('authToken');
    expect(service.isPlatformAdmin()).toBeFalse();
  });

  it('getPostLoginRoute() → /admin/dashboard pour Super Admin & Admin Système, /dashboard sinon', () => {
    localStorage.setItem('authToken', makeJwt({ platform_role: 'ROLE_SUPER_ADMIN' }));
    expect(service.getPostLoginRoute()).toBe('/admin/dashboard');

    localStorage.setItem('authToken', makeJwt({ platform_role: 'ROLE_ADMIN_SYSTEME' }));
    expect(service.getPostLoginRoute()).toBe('/admin/dashboard');

    localStorage.setItem('authToken', makeJwt({ is_superuser: true }));
    expect(service.getPostLoginRoute()).toBe('/admin/dashboard');

    // Rôles d'organisation (Admin/Agent) → tableau de bord opérateur /dashboard.
    localStorage.setItem('authToken', makeJwt({ platform_role: 'ROLE_ORGANISATION_ADMIN' }));
    expect(service.getPostLoginRoute()).toBe('/dashboard');

    localStorage.setItem('authToken', makeJwt({ role: 'AGENT' }));
    expect(service.getPostLoginRoute()).toBe('/dashboard');

    localStorage.removeItem('authToken');
    expect(service.getPostLoginRoute()).toBe('/dashboard');
  });

  it('forgotPassword() POST /forgot-password/ avec l’email', () => {
    service.forgotPassword('a@b.ma').subscribe();
    const req = httpMock.expectOne(`${API}/forgot-password/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.ma' });
    req.flush({});
  });

  it('refreshToken() envoie le refresh et stocke le nouvel access', () => {
    localStorage.setItem('refreshToken', 'ref-123');
    const access = makeJwt({ role: 'AGENT', org_id: 'o1' });
    let got: string | undefined;
    service.refreshToken().subscribe(t => (got = t));

    const req = httpMock.expectOne(`${API}/token/refresh/`);
    expect(req.request.body).toEqual({ refresh: 'ref-123' });
    req.flush({ access });

    expect(got).toBe(access);
    expect(service.getAuthToken()).toBe(access);
    expect(service.getOrganizationId()).toBe('o1');
  });

  it('refreshToken() sans refresh token échoue sans requête', (done) => {
    service.refreshToken().subscribe({
      next: () => fail('ne doit pas réussir'),
      error: () => done(),
    });
    httpMock.expectNone(`${API}/token/refresh/`);
  });

  it('changePassword() envoie le Bearer et déconnecte au succès', () => {
    localStorage.setItem('authToken', 'tok');
    service.changePassword({ current_password: 'a', new_password: 'b' }).subscribe();
    const req = httpMock.expectOne(`${API}/change-password/`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush({ detail: 'ok' });
    // logout() appelé au succès → token purgé.
    expect(service.getAuthToken()).toBeNull();
  });
});
