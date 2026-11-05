/**
 * FORMAT DES DATES — source de vérité unique de l'application.
 *
 * Règle :
 *   - `date_bornage` (affaires) et `date_session` (sessions du SSDGPS) s'affichent
 *     **sans heure** : `jj/mm/aaaa` (l'heure n'a pas de sens métier pour ces deux dates) ;
 *   - **toutes les autres dates** de l'app s'affichent `jj/mm/aaaa hh:mm:ss`.
 *
 * Ne jamais réécrire un `toLocaleString('fr-FR', …)` à la main dans un composant : appeler
 * `formatFieldDate(valeur, champ)` (le champ décide du format) ou, à défaut de champ,
 * `formatDateTime()` / `formatDateOnly()`.
 */

/** Champs affichés SANS heure (format `jj/mm/aaaa`). */
export const DATE_ONLY_FIELDS: ReadonlySet<string> = new Set(['date_bornage', 'date_session']);

/** Valeur affichée quand la date est absente ou invalide. */
export const EMPTY_DATE = '—';

function toDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** `jj/mm/aaaa hh:mm:ss` — format par défaut de l'app. */
export function formatDateTime(value: any, empty: string = EMPTY_DATE): string {
  const d = toDate(value);
  if (!d) return empty;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/**
 * `jj/mm/aaaa` — réservé aux champs de `DATE_ONLY_FIELDS`.
 *
 * Lu en **UTC** et non en heure locale : ces dates sont saisies via `<input type="date">` et
 * enregistrées à minuit UTC (`TIME_ZONE = 'UTC'` côté serveur). Les relire en heure locale
 * ferait basculer l'affichage au jour précédent pour tout fuseau à décalage négatif — l'aller
 * -retour saisie → affichage doit rester stable quel que soit le fuseau de l'opérateur.
 */
export function formatDateOnly(value: any, empty: string = EMPTY_DATE): string {
  const d = toDate(value);
  if (!d) return empty;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

/** Vrai si le champ s'affiche sans heure. */
export function isDateOnlyField(field?: string): boolean {
  return !!field && DATE_ONLY_FIELDS.has(field);
}

/**
 * Formate selon le CHAMP : sans heure pour `date_bornage`/`date_session`, avec heure sinon.
 * C'est la fonction à utiliser dès qu'on connaît le nom du champ (rendu d'une cellule, export…).
 */
export function formatFieldDate(value: any, field?: string, empty: string = EMPTY_DATE): string {
  return isDateOnlyField(field) ? formatDateOnly(value, empty) : formatDateTime(value, empty);
}
