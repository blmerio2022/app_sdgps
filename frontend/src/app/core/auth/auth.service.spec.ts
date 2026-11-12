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

/**
 * Pas d'inscription publique : aucun appel à `/auth/register/` n'existe côté client, et
 * la route `/auth/register` a été retirée du module d'authentification.
 */
describe('AuthService (aucune inscription publique)', () => {
  it("n'expose plus de méthode register()", () => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });
    const service = TestBed.inject(AuthService);
    expect((service as any).register).toBeUndefined();
    TestBed.inject(HttpTestingController).verify();
  });
});

/**
 * API morte retirée : `hasRole`, `isAdmin`, `isManager` et `canAccessOrganization`
 * comparaient le rôle à « ADMIN » / « MANAGER », qui n'existent pas dans cette
 * application — elles renvoyaient donc toujours `false`. Ce test empêche leur retour.
 */
describe('AuthService (API de rôles morte retirée)', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('n\'expose plus les méthodes qui mentaient', () => {
    for (const nom of ['hasRole', 'isAdmin', 'isManager', 'canAccessOrganization']) {
      expect((service as any)[nom]).withContext(nom).toBeUndefined();
    }
  });

  it('conserve les accesseurs réellement utilisés', () => {
    expect(typeof service.getUserRole).toBe('function');
    expect(typeof service.getUserId).toBe('function');
    expect(typeof service.getOrganizationId).toBe('function');
    expect(typeof service.isPlatformAdmin).toBe('function');
  });
});

/**
 * `user_id` arrive du backend sous forme de CHAÎNE (sérialisation simplejwt). Les
 * appelants le comparent à un nombre (`Number(user.id) === currentUserId`) : sans
 * conversion, la comparaison est toujours fausse et le garde-fou « c'est moi » de la
 * liste des utilisateurs ne se déclenche jamais.
 */
describe('AuthService (identifiant utilisateur du JWT)', () => {
  let service: AuthService;

  function connecter(payload: object): void {
    localStorage.setItem('authToken', `x.${btoa(JSON.stringify(payload))}.y`);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
    // Le constructeur appelle /auth/me/ : on absorbe la requête.
    TestBed.inject(HttpTestingController).match(() => true).forEach(r => r.flush({}));
  }

  afterEach(() => localStorage.clear());

  it('convertit un user_id reçu en chaîne', () => {
    connecter({ user_id: '42' });
    expect(service.getUserId()).toBe(42);
  });

  it('accepte un user_id déjà numérique', () => {
    connecter({ user_id: 42 });
    expect(service.getUserId()).toBe(42);
  });

  it('renvoie null quand le claim est absent', () => {
    connecter({ role: 'ROLE_ORGANISATION_AGENT' });
    expect(service.getUserId()).toBeNull();
  });

  it('renvoie null pour un claim inexploitable', () => {
    connecter({ user_id: 'abc' });
    expect(service.getUserId()).toBeNull();
  });

  it('lit l\'organisation depuis le claim org_id', () => {
    connecter({ user_id: '1', org_id: 'uuid-org' });
    expect(service.getOrganizationId()).toBe('uuid-org');
  });

  it('renvoie null quand org_id est vide (compte sans organisation)', () => {
    connecter({ user_id: '1', org_id: '' });
    expect(service.getOrganizationId()).toBeNull();
  });
});
