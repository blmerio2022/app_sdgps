export type UserRole = 'ROLE_SUPER_ADMIN' | 'ROLE_ADMIN_SYSTEME' | 'ROLE_ORGANISATION_ADMIN' | 'ROLE_ORGANISATION_AGENT';

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  nom_societe?: string;
  is_active: boolean;
  is_superuser: boolean;
  // Colonnes d'audit standard (cf. CLAUDE.md). `created_at` est l'alias API de `date_joined`.
  is_deleted: boolean;
  deleted_at?: string;
  created_at?: string;
  updated_at?: string;
  created_by_email?: string | null;
  updated_by_email?: string | null;
  deleted_by_email?: string | null;
  role: UserRole;
  role_display: string;
  organization_name?: string;
  organization_id?: string;
  memberships?: MembershipInfo[];
  last_connection_at?: string;
  password_changed_at?: string;
  must_change_password: boolean;
  date_joined: string;
}

export interface MembershipInfo {
  organization_id: string;
  organization_name: string;
  role: string;
  role_display: string;
  joined_at: string;
}

export interface CreateUserPayload {
  email: string;
  first_name: string;
  last_name: string;
  nom_societe?: string;
  password: string;
  role: UserRole;
  organization_id: string;
  must_change_password: boolean;
}

export interface UpdateUserPayload {
  first_name?: string;
  last_name?: string;
  nom_societe?: string;
  is_active?: boolean;
  role?: UserRole;
  organization_id?: string;
}

export interface ResetPasswordPayload {
  new_password?: string;
  must_change_password: boolean;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  user_count: number;
}
