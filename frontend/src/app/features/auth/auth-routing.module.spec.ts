import { routes } from './auth-routing.module';

/**
 * Aucune route d'inscription : un compte n'est créé que par le Super Admin ou l'Admin
 * Système depuis l'administration des utilisateurs.
 */
describe('AuthRoutingModule', () => {
  const chemins = routes.map(r => r.path);

  it('déclare la connexion mais pas l\'inscription', () => {
    expect(chemins).toContain('login');
    expect(chemins).not.toContain('register');
  });

  it('déclare les parcours de mot de passe', () => {
    expect(chemins).toContain('forgot-password');
    expect(chemins).toContain('verify-code');
    expect(chemins).toContain('reset-password');
    expect(chemins).toContain('change-password');
  });

  it('aucune route ne pointe vers un composant d\'inscription', () => {
    const noms = routes
      .map(r => (r.component as any)?.name ?? '')
      .join(' ');
    expect(noms).not.toContain('Register');
  });
});
