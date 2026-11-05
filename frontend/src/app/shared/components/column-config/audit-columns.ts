/**
 * COLONNES D'AUDIT STANDARD — source de vérité unique des libellés et de l'ordre.
 *
 * Ces 7 colonnes doivent être présentes dans TOUS les tableaux de l'app (cf. CLAUDE.md,
 * « Colonnes d'audit obligatoires »). Les libellés sont volontairement centralisés ici pour
 * garantir qu'ils restent identiques partout : ne jamais réécrire « Date de création »,
 * « Dernière modification », etc. dans un composant — importer `auditColumns()`.
 *
 * Convention de nommage des champs API : `created_at` / `updated_at` / `is_deleted` /
 * `deleted_at` / `created_by_email` / `updated_by_email` / `deleted_by_email`.
 */
export interface AuditColumnDef {
  field: string;
  label: string;
  visible: boolean;
  type: 'date' | 'boolean' | 'text';
  description: string;
}

/** Libellés unifiés, indexés par champ (utile pour vérifier/normaliser un catalogue existant). */
export const AUDIT_COLUMN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  created_by_email: 'Créé par',
  created_at: 'Créé le',
  updated_by_email: 'Modifié par',
  updated_at: 'Modifié le',
  is_deleted: 'Supprimé',
  deleted_by_email: 'Supprimé par',
  deleted_at: 'Supprimé le',
});

/** Descriptions unifiées (colonne « Description » de la modale d'organisation des colonnes). */
export const AUDIT_COLUMN_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  created_by_email: "Utilisateur ayant créé l'enregistrement",
  created_at: "Date et heure de création de l'enregistrement",
  updated_by_email: 'Utilisateur ayant effectué la dernière modification',
  updated_at: 'Date et heure de la dernière modification',
  is_deleted: "Indique si l'enregistrement a été supprimé (suppression logique)",
  deleted_by_email: "Utilisateur ayant supprimé l'enregistrement",
  deleted_at: 'Date et heure de la suppression logique',
});

/** Ordre d'affichage standard des colonnes d'audit (toujours en fin de catalogue). */
export const AUDIT_COLUMN_ORDER: readonly string[] = Object.freeze([
  'created_by_email', 'created_at',
  'updated_by_email', 'updated_at',
  'is_deleted', 'deleted_by_email', 'deleted_at',
]);

/** Vrai si `field` est une colonne d'audit standard. */
export function isAuditColumn(field: string): boolean {
  return Object.prototype.hasOwnProperty.call(AUDIT_COLUMN_LABELS, field);
}

/**
 * Catalogue des 7 colonnes d'audit, masquées par défaut (elles restent activables via la modale
 * « Colonnes »). À concaténer EN FIN du catalogue propre au tableau :
 *
 *     columns: ColumnConfig[] = [ ...colonnes métier..., ...auditColumns() ];
 */
export function auditColumns(): AuditColumnDef[] {
  return AUDIT_COLUMN_ORDER.map(field => ({
    field,
    label: AUDIT_COLUMN_LABELS[field],
    visible: false,
    type: field === 'is_deleted' ? 'boolean' : (field.endsWith('_at') ? 'date' : 'text'),
    description: AUDIT_COLUMN_DESCRIPTIONS[field],
  } as AuditColumnDef));
}

/**
 * Normalise un catalogue existant : force les libellés/descriptions unifiés sur les colonnes
 * d'audit déjà présentes, puis AJOUTE en fin celles qui manquent. Ne touche pas aux colonnes
 * métier et préserve leur ordre ainsi que la visibilité déjà choisie pour les colonnes d'audit.
 */
export function withAuditColumns<T extends { field: string; label: string; visible: boolean }>(
  catalog: T[],
): T[] {
  const out = catalog.map(col => (
    isAuditColumn(col.field)
      ? { ...col, label: AUDIT_COLUMN_LABELS[col.field],
          description: AUDIT_COLUMN_DESCRIPTIONS[col.field] }
      : { ...col }
  ));
  const present = new Set(out.map(c => c.field));
  for (const def of auditColumns()) {
    if (!present.has(def.field)) out.push(def as unknown as T);
  }
  return out;
}
