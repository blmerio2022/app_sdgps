import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { SecuriteSettingsComponent } from './securite-settings.component';
import { SecuriteService, appareil } from '../../../core/services/securite.service';
import { environment } from '../../../../environments/environment';

const S = (id: string, courante = false): any => ({ id, adresse_ip: '1.2.3.4', agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
  created_at: '', derniere_activite: '', expire_le: '', double_auth: false, courante });

describe('SecuriteService', () => {
  it('routes de la double authentification et des sessions', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(SecuriteService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${environment.apiUrl}/auth/me/`;
    svc.activerMfa('123456').subscribe();
    expect(http.expectOne(`${base}mfa/activer/`).request.body).toEqual({ code: '123456' });
    svc.desactiverMfa('mdp', '1').subscribe();
    expect(http.expectOne(`${base}mfa/desactiver/`).request.body).toEqual({ mot_de_passe: 'mdp', code: '1' });
    svc.revoquer('s1').subscribe();
    http.expectOne(`${base}sessions/s1/revoquer/`);
    http.verify();
  });

  it('appareil lisible', () => {
    expect(appareil('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe('Chrome · Windows');
    expect(appareil('Mozilla/5.0 (iPhone; CPU iPhone OS) Safari/604')).toBe('Safari · iOS');
    expect(appareil('')).toBe('Appareil inconnu');
  });
});

describe('SecuriteSettingsComponent', () => {
  let svc: any;
  let toast: any;
  let cmp: SecuriteSettingsComponent;

  beforeEach(() => {
    svc = {
      etatMfa: jasmine.createSpy('etat').and.returnValue(of({ active: false, active_le: null, codes_secours_restants: 0 })),
      initierMfa: jasmine.createSpy('initier').and.returnValue(of({ secret: 'ABCD EFGH', uri: 'otpauth://x' })),
      activerMfa: jasmine.createSpy('activer').and.returnValue(of({ active: true, active_le: '', codes_secours_restants: 8,
                                                                    codes_secours: ['1111-2222'] })),
      desactiverMfa: jasmine.createSpy('desactiver').and.returnValue(of({ active: false, active_le: null, codes_secours_restants: 0 })),
      regenererCodes: jasmine.createSpy('regen').and.returnValue(of({ active: true, codes_secours: ['3333-4444'] })),
      sessions: jasmine.createSpy('sessions').and.returnValue(of([S('a', true), S('b')])),
      revoquer: jasmine.createSpy('revoquer').and.returnValue(of({ revoquees: 1 })),
      revoquerAutres: jasmine.createSpy('autres').and.returnValue(of({ revoquees: 1 })),
    };
    toast = jasmine.createSpyObj('Toast', ['success', 'error']);
    cmp = new SecuriteSettingsComponent(svc, toast);
    cmp.ngOnInit();
  });

  it('activation : clé, code, puis codes de secours montrés une fois', () => {
    cmp.commencer();
    expect(cmp.mode).toBe('activation');
    expect(cmp.secret).toBe('ABCD EFGH');
    cmp.code = '123456';
    cmp.activer();
    expect(cmp.mode).toBe('codes');
    expect(cmp.codesSecours).toEqual(['1111-2222']);
    cmp.terminerCodes();
    expect(cmp.codesSecours).toEqual([]);
    expect(cmp.mfa?.active).toBeTrue();
  });

  it('code refusé : message du serveur', () => {
    svc.activerMfa.and.returnValue(throwError(() => ({ error: { detail: 'Code incorrect' } })));
    cmp.commencer(); cmp.code = '000000'; cmp.activer();
    expect(cmp.erreur).toBe('Code incorrect');
    expect(cmp.mode).toBe('activation');
  });

  it('désactivation exige mot de passe et code', () => {
    cmp.mode = 'desactivation';
    cmp.code = '1';
    cmp.desactiver();
    expect(svc.desactiverMfa).not.toHaveBeenCalled();
    cmp.motDePasse = 'mdp';
    cmp.desactiver();
    expect(svc.desactiverMfa).toHaveBeenCalledWith('mdp', '1');
    expect(cmp.mode).toBe('repos');
  });

  it('sessions : fermer une, fermer les autres', () => {
    expect(cmp.autres).toBe(1);
    cmp.revoquer(cmp.sessions[1]);
    expect(cmp.sessions.map(s => s.id)).toEqual(['a']);
    cmp.sessions = [S('a', true), S('c')];
    cmp.revoquerAutres();
    expect(cmp.sessions.map(s => s.id)).toEqual(['a']);
  });
});
