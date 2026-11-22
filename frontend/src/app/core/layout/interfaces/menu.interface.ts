/**
 * Interface pour la structure d'un élément de menu
 */
export interface MenuItem {
  id: string;
  title: string;
  icon?: string;
  route?: string;
  type: 'link' | 'submenu';
  description?: string;
  children?: MenuItem[];
  roles?: string[];
  /** Correspondance EXACTE pour l'état actif (routerLinkActiveOptions). À activer pour les
   * routes « racine » qui préfixent d'autres entrées (ex. « Tableau de bord » = /home,
   * à ne pas garder actif sur /projets…) afin de ne pas rester actives partout. */
  exact?: boolean;
  badge?: {
    text: string;
    color: string;
  };
}

/**
 * Interface pour le fil d'Ariane (breadcrumb)
 */
export interface BreadcrumbItem {
  label: string;
  route?: string;
  isActive?: boolean;
  /** Icône FontAwesome optionnelle (ex. 'fa-house' pour l'accueil). */
  icon?: string;
  /** Query params à propager dans le routerLink (ex. restauration d'un niveau de l'explorateur). */
  queryParams?: Record<string, any>;
  /** Élément métier représenté : sa fiche s'affiche au survol du crumb (`GET fiche/<type>/<id>/`). */
  fiche?: { type: TypeFiche; id: string };
}

export type TypeFiche = 'projet' | 'propriete' | 'affaire' | 'ssdgps' | 'session' | 'piece';

/**
 * Interface pour l'utilisateur connecté
 */
export interface UserProfile {
  id: number;
  email: string;
  first_name: string;   // Prénom (champ Django standard)
  last_name: string;    // Nom (champ Django standard)
  role: string;
  avatar?: string;
  organization_name?: string | null;  // Organisation principale (agents / admins d'org)
  last_connection_at?: string;  // ← AJOUT: Date dernière connexion (ISO format)
}

/**
 * État du thème (clair/sombre)
 */
export type ThemeMode = 'light' | 'dark';

/**
 * État de la sidebar
 */
export interface SidebarState {
  isCollapsed: boolean;
  isVisible: boolean;
}
