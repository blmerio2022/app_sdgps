import { OrgSortLevel } from '../../../core/services/org-sort-config.service';

/** Un champ triable proposé dans la modale de tri multi-niveaux (clé technique + libellé). */
export interface SortableField { field: string; label: string; }

/** Valeur comparable d'un champ (booléens → 0/1, texte insensible à la casse, null → ''). */
export function sortValue(row: any, field: string): number | string {
  const v = row?.[field];
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'string' ? v.toLowerCase() : v;
}

/** Comparateur multi-niveaux : parcourt les niveaux dans l'ordre, le premier départage. */
export function compareByLevels(a: any, b: any, levels: OrgSortLevel[]): number {
  for (const lvl of levels) {
    const va = sortValue(a, lvl.field);
    const vb = sortValue(b, lvl.field);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    if (cmp !== 0) return lvl.dir === 'desc' ? -cmp : cmp;
  }
  return 0;
}

/** Rang (1..n) du champ dans le tri multi-niveaux, ou 0 s'il n'y participe pas. */
export function sortLevelOf(levels: OrgSortLevel[], field: string): number {
  const i = levels.findIndex(l => l.field === field);
  return i < 0 ? 0 : i + 1;
}

/** Sens de tri du champ ('asc'/'desc') s'il est trié, sinon ''. */
export function sortDirOf(levels: OrgSortLevel[], field: string): '' | 'asc' | 'desc' {
  return levels.find(l => l.field === field)?.dir || '';
}
