import { initSentry, sentryEstActif } from './sentry';

/**
 * L'exigence centrale : sans DSN, RIEN ne doit être initialisé — pas d'appel réseau,
 * pas de collecte. C'est l'état du dépôt par défaut.
 */
describe('Observabilité (Sentry)', () => {
  const DSN = 'https://cle@exemple.ingest.sentry.io/1';
  let init: jasmine.Spy;

  beforeEach(() => {
    init = jasmine.createSpy('Sentry.init');
  });

  describe('sentryEstActif', () => {
    it('est faux sans DSN', () => {
      expect(sentryEstActif({ sentryDsn: '' })).toBeFalse();
      expect(sentryEstActif({})).toBeFalse();
    });

    it('est faux pour un DSN uniquement composé d\'espaces', () => {
      expect(sentryEstActif({ sentryDsn: '   ' })).toBeFalse();
    });

    it('est vrai avec un DSN renseigné', () => {
      expect(sentryEstActif({ sentryDsn: DSN })).toBeTrue();
    });
  });

  describe('initSentry', () => {
    it('n\'initialise rien sans DSN', () => {
      expect(initSentry({ sentryDsn: '' }, init)).toBeFalse();
      expect(init).not.toHaveBeenCalled();
    });

    it('n\'initialise rien pour un DSN vide de sens', () => {
      expect(initSentry({ sentryDsn: '  ' }, init)).toBeFalse();
      expect(init).not.toHaveBeenCalled();
    });

    it('initialise avec un DSN', () => {
      expect(initSentry({ sentryDsn: DSN }, init)).toBeTrue();
      expect(init).toHaveBeenCalled();
    });

    it('n\'envoie aucune donnée personnelle par défaut', () => {
      initSentry({ sentryDsn: DSN }, init);

      const options = init.calls.mostRecent().args[0] as any;
      expect(options.sendDefaultPii).toBeFalse();
      expect(options.tracesSampleRate).toBe(0);
    });

    it('transmet l\'environnement', () => {
      initSentry({ sentryDsn: DSN, production: true }, init);

      expect((init.calls.mostRecent().args[0] as any).environment).toBe('production');
    });

    it('nettoie les espaces autour du DSN', () => {
      initSentry({ sentryDsn: `  ${DSN}  ` }, init);

      expect((init.calls.mostRecent().args[0] as any).dsn).toBe(DSN);
    });
  });

  describe('configuration du dépôt', () => {
    it('ne contient aucun DSN en dur', async () => {
      const { environment } = await import('../../../environments/environment');

      expect(environment.sentryDsn).toBe('');
    });
  });
});
