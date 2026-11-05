/**
 * Helpers du FILTRE DE COLONNE façon Excel (composant `<app-column-filter>`).
 *
 * Principe : le filtre porte sur la valeur **affichée** de la cellule (comme dans Excel), et non
 * sur la valeur brute — une date filtrée sur « 21/07/2026 » et non sur l'ISO, un booléen sur
 * « Oui »/« Non ». Le parent fournit donc le même formateur que celui utilisé pour le rendu.
 */

/** Valeurs sélectionnées par champ. Une entrée absente = colonne non filtrée (toutes valeurs). */
export type ColumnFilterMap = { [field: string]: string[] };

/** Une valeur distincte proposée dans la liste du filtre, avec son nombre d'occurrences. */
export interface ColumnFacet {
  /** Valeur affichée (clé de filtrage). */
  value: string;
  /** Libellé montré à l'opérateur (« (Vides) » pour la chaîne vide). */
  label: string;
  /** Nombre de lignes portant cette valeur. */
  count: number;
}

/** Libellé des cellules vides dans la liste des valeurs (comme Excel). */
export const EMPTY_FACET_LABEL = '(Vides)';

/** Formateur par défaut : valeur brute convertie en texte, `null`/`undefined` → chaîne vide. */
export function defaultFormat(row: any, field: string): string {
  const v = row?.[field];
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return String(v);
}

/**
 * Valeurs distinctes d'une colonne, triées de façon naturelle (numérique quand c'est possible,
 * sinon alphabétique, insensible à la casse/accents). Les vides sont regroupés et placés en fin.
 */
export function distinctColumnValues(
  rows: any[],
  field: string,
  format: (row: any, field: string) => string = defaultFormat,
  type?: string,
): ColumnFacet[] {
  const counts = new Map<string, number>();
  // Valeur BRUTE associée à chaque valeur affichée : indispensable pour trier les dates
  // chronologiquement et les nombres numériquement (l'affichage seul ne suffit pas).
  const raws = new Map<string, any>();
  for (const row of rows || []) {
    const value = (format(row, field) ?? '').trim();
    counts.set(value, (counts.get(value) || 0) + 1);
    if (!raws.has(value)) raws.set(value, row?.[field]);
  }
  const facets: ColumnFacet[] = [...counts.entries()].map(([value, count]) => ({
    value,
    label: value === '' ? EMPTY_FACET_LABEL : value,
    count,
  }));

  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  return facets.sort((a, b) => {
    if (a.value === '') return 1;            // les vides toujours en dernier
    if (b.value === '') return -1;
    // Tri adapté au TYPE (numérique / chronologique), avec repli alphabétique.
    const ka = sortKeyFor(type, a.value, raws.get(a.value));
    const kb = sortKeyFor(type, b.value, raws.get(b.value));
    if (ka !== null && kb !== null && ka !== kb) return ka - kb;
    if (ka !== null && kb === null) return -1;
    if (ka === null && kb !== null) return 1;
    return collator.compare(a.value, b.value);
  });
}

/** Valeurs brutes indexées par valeur affichée (pour l'arborescence des dates). */
export function rawValueMap(
  rows: any[],
  field: string,
  format: (row: any, field: string) => string = defaultFormat,
): Map<string, any> {
  const raws = new Map<string, any>();
  for (const row of rows || []) {
    const value = (format(row, field) ?? '').trim();
    if (!raws.has(value)) raws.set(value, row?.[field]);
  }
  return raws;
}

/** Normalise pour la recherche : minuscules, sans accents. */
export function normalizeSearch(text: string): string {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Vrai si la colonne porte un filtre actif. */
export function isColumnFiltered(filters: ColumnFilterMap, field: string): boolean {
  return Array.isArray(filters?.[field]);
}

/** Nombre de colonnes filtrées (utile pour un indicateur global « Effacer les filtres »). */
export function activeFilterCount(filters: ColumnFilterMap): number {
  return Object.keys(filters || {}).filter(f => Array.isArray(filters[f])).length;
}

/**
 * Vrai si une ligne satisfait TOUS les filtres de colonne (ET entre colonnes, OU entre les
 * valeurs d'une même colonne — sémantique d'Excel).
 */
export function rowMatchesColumnFilters(
  row: any,
  filters: ColumnFilterMap,
  format: (row: any, field: string) => string = defaultFormat,
): boolean {
  for (const field of Object.keys(filters || {})) {
    const allowed = filters[field];
    if (!Array.isArray(allowed)) continue;   // colonne non filtrée
    const value = (format(row, field) ?? '').trim();
    if (!allowed.includes(value)) return false;
  }
  return true;
}

/**
 * Applique/retire le filtre d'une colonne dans une NOUVELLE map (jamais de mutation).
 * `values === null` (ou toutes les valeurs sélectionnées côté appelant) retire le filtre.
 */
export function withColumnFilter(
  filters: ColumnFilterMap,
  field: string,
  values: string[] | null,
): ColumnFilterMap {
  const next: ColumnFilterMap = { ...(filters || {}) };
  if (values === null) delete next[field];
  else next[field] = [...values];
  return next;
}

/* =====================================================================
   ADAPTATION AU TYPE DE DONNÉES (comme Excel)
   Le tri et la présentation des valeurs dépendent du type de la colonne :
   - nombre  → tri NUMÉRIQUE (9 < 20 < 100), affichage aligné à droite ;
   - date    → tri CHRONOLOGIQUE et regroupement Année ▸ Mois ▸ Jour ;
   - texte   → tri alphabétique (casse/accents ignorés).
   ===================================================================== */

/** Types de colonne reconnus (alignés sur les catalogues des tableaux). */
export type ColumnDataType = 'text' | 'number' | 'date' | 'email' | 'boolean' | 'status' | 'role';

/** Intitulé du type de filtre, affiché dans l'en-tête du menu (vocabulaire Excel). */
export function filterKindLabel(type?: string): string {
  if (type === 'number') return 'Filtres numériques';
  if (type === 'date') return 'Filtres chronologiques';
  if (type === 'boolean') return 'Filtres logiques';
  return 'Filtres textuels';
}

/** Convertit une valeur en nombre (accepte « 1 234,56 », espaces fines, %, etc.). Sinon `null`. */
export function parseNumberValue(value: any): number | null {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[^0-9.,+-]/g, '')
    .replace(',', '.');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/**
 * Convertit une valeur en date. Accepte l'ISO renvoyé par l'API et l'affichage français
 * `jj/mm/aaaa [hh:mm]` (le formateur d'un tableau produit ce dernier). Sinon `null`.
 */
export function parseDateValue(value: any): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();

  // Affichage français jj/mm/aaaa (éventuellement suivi de l'heure).
  const fr = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[\s,]+(\d{2}):(\d{2}))?/);
  if (fr) {
    const [, d, m, y, hh, mm] = fr;
    const date = new Date(+y, +m - 1, +d, hh ? +hh : 0, mm ? +mm : 0);
    return isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(text);
  return isNaN(iso.getTime()) ? null : iso;
}

/** Clé de tri d'une facette selon le type de colonne (`null` = repli sur l'ordre alphabétique). */
function sortKeyFor(type: string | undefined, display: string, raw: any): number | null {
  if (type === 'number') return parseNumberValue(raw !== undefined && raw !== null && raw !== '' ? raw : display);
  if (type === 'date') {
    const d = parseDateValue(raw) ?? parseDateValue(display);
    return d ? d.getTime() : null;
  }
  return null;
}

/* ---------------------------------------------------------------- arborescence des DATES */

/** Nœud de l'arborescence Année ▸ Mois ▸ Jour (filtre chronologique façon Excel). */
export interface DateNode {
  /** Identifiant stable (`2026`, `2026-06`, `2026-06-21`). */
  key: string;
  /** Libellé affiché (`2026`, `juin`, `21`). */
  label: string;
  level: 'year' | 'month' | 'day';
  /** Valeurs de facette couvertes par ce nœud (feuilles). */
  values: string[];
  /** Somme des occurrences des feuilles couvertes. */
  count: number;
  children: DateNode[];
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Regroupe des facettes de dates en Année ▸ Mois ▸ Jour (ordre chronologique).
 * Les valeurs non interprétables comme des dates (dont les vides) sont renvoyées à part, pour
 * rester filtrables — Excel les place également en fin de liste.
 */
export function buildDateTree(facets: ColumnFacet[], raws?: Map<string, any>):
    { tree: DateNode[]; others: ColumnFacet[] } {
  const years = new Map<string, DateNode>();
  const others: ColumnFacet[] = [];

  for (const facet of facets) {
    const date = parseDateValue(raws?.get(facet.value)) ?? parseDateValue(facet.value);
    if (!date) { others.push(facet); continue; }

    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    let year = years.get(y);
    if (!year) {
      year = { key: y, label: y, level: 'year', values: [], count: 0, children: [] };
      years.set(y, year);
    }
    let month = year.children.find(c => c.key === `${y}-${m}`);
    if (!month) {
      month = { key: `${y}-${m}`, label: MONTHS[date.getMonth()], level: 'month',
                values: [], count: 0, children: [] };
      year.children.push(month);
    }
    let day = month.children.find(c => c.key === `${y}-${m}-${d}`);
    if (!day) {
      day = { key: `${y}-${m}-${d}`, label: d, level: 'day', values: [], count: 0, children: [] };
      month.children.push(day);
    }

    for (const node of [year, month, day]) {
      node.values.push(facet.value);
      node.count += facet.count;
    }
  }

  const tree = [...years.values()].sort((a, b) => +a.key - +b.key);
  for (const year of tree) {
    year.children.sort((a, b) => a.key.localeCompare(b.key));
    for (const month of year.children) month.children.sort((a, b) => a.key.localeCompare(b.key));
  }
  return { tree, others };
}
