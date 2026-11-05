/**
 * Helpers de la configuration des COLONNES (visibilité + ordre) partagée. `ManagedColumn` est
 * structurellement compatible avec les interfaces `ColumnConfig` locales des listes (mêmes champs
 * `field`, `label`, `visible`, `type`, ...). Le composant `<app-column-config>` manipule des
 * `ManagedColumn` ; les helpers restent génériques pour accepter tout `ColumnConfig` local.
 */
export interface ManagedColumn {
  field: string;
  label: string;
  visible: boolean;
  type?: string;
  /** Description optionnelle (info-bulle). */
  description?: string;
}

/** Préférence de colonne persistée (backend / service). */
export interface StoredColumnPref {
  field: string;
  visible: boolean;
}

/**
 * Applique une config persistée (`stored`) au CATALOGUE de colonnes d'un tableau :
 * - réordonne les colonnes selon l'ordre de `stored` ;
 * - applique la visibilité de `stored` ;
 * - AJOUTE en fin, telles qu'au catalogue, les colonnes absentes de `stored` (nouvelles colonnes
 *   ajoutées après la dernière sauvegarde) ;
 * - ignore les entrées de `stored` inconnues du catalogue.
 * Renvoie TOUJOURS une nouvelle liste (copies de 1er niveau), sans muter `catalog`. Si `stored`
 * est vide, renvoie une copie du catalogue inchangée.
 */
export function applyColumnsConfig<T extends { field: string; visible: boolean }>(
  catalog: T[],
  stored: StoredColumnPref[] | null | undefined,
): T[] {
  const copyCatalog = () => catalog.map(c => ({ ...c }));
  if (!Array.isArray(stored) || !stored.length) return copyCatalog();

  const byField = new Map(catalog.map(c => [c.field, { ...c }]));
  const ordered: T[] = [];
  for (const pref of stored) {
    if (!pref || !pref.field) continue;
    const col = byField.get(pref.field);
    if (!col) continue; // entrée obsolète / inconnue → ignorée
    col.visible = !!pref.visible;
    ordered.push(col);
    byField.delete(pref.field);
  }
  // Colonnes du catalogue non présentes dans stored (nouvelles) → ajoutées en fin, ordre catalogue.
  for (const col of catalog) {
    const remaining = byField.get(col.field);
    if (remaining) ordered.push(remaining);
  }
  return ordered;
}

/** Réduit une liste de colonnes à sa forme persistable `[{field, visible}]` (ordre conservé). */
export function toColumnPrefs(columns: { field: string; visible: boolean }[]): StoredColumnPref[] {
  return columns.map(c => ({ field: c.field, visible: !!c.visible }));
}
