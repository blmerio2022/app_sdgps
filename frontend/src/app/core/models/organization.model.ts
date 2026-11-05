export interface Organization {
  id: string;  // Django UUIDField retourne une string
  code: string;
  name: string;
  type: string;
  type_display: string;
  legal_id?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo?: string;
  parent?: string | null;  // UUID ou null
  full_path?: string;
  is_active: boolean;
  member_count: number;
  // Colonnes d'audit standard (cf. CLAUDE.md). `modified_by_email` est l'ancien nom conservé
  // par l'API pour compatibilité ; `updated_by_email` est le nom unifié dans toute l'app.
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_by_email?: string;
  modified_by_email?: string;
  updated_by_email?: string;
  deleted_by_email?: string;
  is_test_data?: boolean;
}
