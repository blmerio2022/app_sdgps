import {
  formatDateTime, formatDateOnly, formatFieldDate, isDateOnlyField,
  DATE_ONLY_FIELDS, EMPTY_DATE,
} from './date-format.util';

/**
 * Format des dates de l'app : `date_bornage` et `date_session` SANS heure (`jj/mm/aaaa`),
 * toutes les autres dates en `jj/mm/aaaa hh:mm:ss`.
 */
describe('date-format.util', () => {
  // 21 juillet 2026, 14:05:09 (heure locale : on construit la date localement pour éviter
  // toute dérive de fuseau dans l'assertion).
  const d = new Date(2026, 6, 21, 14, 5, 9);

  it('formatDateTime rend jj/mm/aaaa hh:mm:ss', () => {
    expect(formatDateTime(d)).toBe('21/07/2026 14:05:09');
  });

  it('formatDateOnly rend jj/mm/aaaa (sans heure)', () => {
    const out = formatDateOnly(d);
    expect(out).toBe('21/07/2026');
    expect(out).not.toContain(':');
  });

  it('les deux champs métier sont bien déclarés sans heure', () => {
    expect([...DATE_ONLY_FIELDS].sort()).toEqual(['date_bornage', 'date_session']);
    expect(isDateOnlyField('date_bornage')).toBeTrue();
    expect(isDateOnlyField('date_session')).toBeTrue();
    expect(isDateOnlyField('created_at')).toBeFalse();
    expect(isDateOnlyField(undefined)).toBeFalse();
  });

  describe('formatFieldDate : le champ décide du format', () => {
    it('date_bornage et date_session : sans heure', () => {
      expect(formatFieldDate(d, 'date_bornage')).toBe('21/07/2026');
      expect(formatFieldDate(d, 'date_session')).toBe('21/07/2026');
    });

    it('toutes les autres dates : avec heure, secondes comprises', () => {
      for (const field of ['created_at', 'updated_at', 'deleted_at', 'last_connection_at']) {
        expect(formatFieldDate(d, field)).withContext(field).toBe('21/07/2026 14:05:09');
      }
      // Sans champ connu → format par défaut (avec heure).
      expect(formatFieldDate(d)).toBe('21/07/2026 14:05:09');
    });

    it('une heure non nulle n’apparaît PAS pour les champs sans heure', () => {
      const soir = new Date(2026, 6, 21, 23, 59, 59);
      expect(formatFieldDate(soir, 'date_session')).toBe('21/07/2026');
    });
  });

  describe('valeurs absentes ou invalides', () => {
    it('renvoie le repli par défaut', () => {
      for (const v of [null, undefined, '', 'pas une date']) {
        expect(formatDateTime(v)).toBe(EMPTY_DATE);
        expect(formatDateOnly(v)).toBe(EMPTY_DATE);
        expect(formatFieldDate(v, 'date_session')).toBe(EMPTY_DATE);
      }
    });

    it('accepte un repli personnalisé (certains tableaux affichent « - »)', () => {
      expect(formatDateTime(null, '-')).toBe('-');
      expect(formatDateOnly(null, '-')).toBe('-');
    });
  });

  describe('stabilité de l’aller-retour saisie → affichage (fuseaux)', () => {
    it('une date saisie via <input type="date"> se réaffiche au MÊME jour', () => {
      // Ce que le backend enregistre pour une saisie « 2026-07-21 » : minuit UTC.
      const stocke = '2026-07-21T00:00:00Z';
      expect(formatFieldDate(stocke, 'date_bornage')).toBe('21/07/2026');
      expect(formatFieldDate(stocke, 'date_session')).toBe('21/07/2026');
    });

    it('pas de bascule au jour précédent en fin de journée UTC', () => {
      expect(formatFieldDate('2026-07-21T23:30:00Z', 'date_session')).toBe('21/07/2026');
    });

    it('pas de bascule au jour suivant en début de journée UTC', () => {
      expect(formatFieldDate('2026-07-21T00:30:00Z', 'date_bornage')).toBe('21/07/2026');
    });
  });

  it('accepte une chaîne ISO du backend', () => {
    const iso = new Date(2026, 0, 2, 8, 30, 0).toISOString();
    expect(formatFieldDate(iso, 'created_at')).toBe('02/01/2026 08:30:00');
    expect(formatFieldDate(iso, 'date_bornage')).toBe('02/01/2026');
  });
});
