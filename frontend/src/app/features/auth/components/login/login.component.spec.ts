import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';

describe('LoginComponent (logique)', () => {
  let cmp: LoginComponent;

  beforeEach(() => {
    cmp = new LoginComponent({} as any, {} as any, {} as any, {} as any);
  });

  it('togglePasswordVisibility() bascule l’affichage du mot de passe', () => {
    expect(cmp.showPassword).toBeFalse();
    cmp.togglePasswordVisibility();
    expect(cmp.showPassword).toBeTrue();
    cmp.togglePasswordVisibility();
    expect(cmp.showPassword).toBeFalse();
  });

  describe('double authentification', () => {
    let auth: any;
    beforeEach(() => {
      auth = {
        login: jasmine.createSpy('login').and.returnValue(of({ mfa_requis: true, jeton_mfa: 'J' })),
        loginMfa: jasmine.createSpy('loginMfa').and.returnValue(of({ token: 't' })),
      };
      cmp = new LoginComponent({ group: () => ({ valid: true, value: { email: 'a@b.c', password: 'xxxxxx' } }) } as any,
                               auth, {} as any, {} as any);
      cmp.ngOnInit();
    });

    it('mot de passe accepté + 2FA active → étape du code, sans jeton enregistré', () => {
      cmp.onSubmit();
      expect(cmp.jetonMfa).toBe('J');
      cmp.codeMfa = ' 123456 ';
      cmp.validerCode();
      expect(auth.loginMfa).toHaveBeenCalledWith('J', '123456');
    });

    it('code refusé : tentatives restantes ; étape expirée : retour au formulaire', () => {
      cmp.onSubmit();
      auth.loginMfa.and.returnValue(throwError(() => ({ error: { code: 'MFA_INVALID', remaining_attempts: 3 } })));
      cmp.codeMfa = '000000';
      cmp.validerCode();
      expect(cmp.errorMessage).toBe('Code incorrect. Tentatives restantes : 3.');
      auth.loginMfa.and.returnValue(throwError(() => ({ error: { code: 'MFA_EXPIRED' } })));
      cmp.validerCode();
      expect(cmp.jetonMfa).toBeNull();
      expect(cmp.errorMessage).toContain('expirée');
    });
  });
});
