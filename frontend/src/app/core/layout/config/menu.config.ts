import { MenuItem } from '../interfaces/menu.interface';

/**
 * Configuration du menu pour les utilisateurs normaux
 */
export const USER_MENU: MenuItem[] = [
  {
    id: 'dashboard',
    title: 'Tableau de bord',
    icon: 'fas fa-tachometer-alt',
    route: '/dashboard', // tableau de bord opérateur (Agent d'organisation)
    type: 'link',
    exact: true, // évite de rester actif sur les sous-routes (/projets…)
    description: 'Vue d\'ensemble de vos projets et activités'
  },
  {
    id: 'projets',
    title: 'Projets',
    icon: 'fas fa-project-diagram',
    route: '/projets',
    type: 'link',
    description: 'Projets, propriétés, affaires, SSDGPS & sessions'
  },
  {
    // Regroupement « Paramètres » (route hors AdminGuard, accessible à l'agent).
    id: 'parametres',
    title: 'Paramètres',
    icon: 'fas fa-sliders-h',
    route: '/parametres',
    type: 'submenu',
    description: 'Préférences d\'affichage des pièces (tri + colonnes)',
    children: [
      {
        id: 'tri-pieces',
        title: 'Tri des pièces',
        icon: 'fas fa-sort-amount-down',
        route: '/parametres/tri-pieces',
        type: 'link',
        description: 'Champ de tri par défaut des tableaux de pièces (affichage + rapport PDF)'
      },
      {
        id: 'champs-pieces',
        title: 'Champs par défaut',
        icon: 'fas fa-table-columns',
        route: '/parametres/champs-pieces',
        type: 'link',
        description: 'Colonnes affichées par type de pièce (vues app + rapport PDF)'
      }
    ]
  }
];

/**
 * Configuration du menu pour le Super Admin
 */
const ALL_ADMIN_ROLES = ['ROLE_SUPER_ADMIN', 'ROLE_ADMIN_SYSTEME', 'ROLE_ORGANISATION_ADMIN'];
const SUPER_OR_SYSTEME = ['ROLE_SUPER_ADMIN', 'ROLE_ADMIN_SYSTEME'];

export const ADMIN_MENU: MenuItem[] = [
  {
    // Super Admin & Admin Système → tableau de bord admin.
    id: 'dashboard',
    title: 'Tableau de bord',
    icon: 'fas fa-tachometer-alt',
    route: '/admin/dashboard',
    type: 'link',
    exact: true, // correspondance exacte (cohérence avec le menu opérateur)
    description: 'Vue d\'ensemble système',
    roles: SUPER_OR_SYSTEME,
  },
  {
    // Admin d'organisation → tableau de bord opérateur /dashboard (même page que l'Agent).
    id: 'dashboard-org',
    title: 'Tableau de bord',
    icon: 'fas fa-tachometer-alt',
    route: '/dashboard',
    type: 'link',
    exact: true,
    description: 'Vue d\'ensemble de vos projets et activités',
    roles: ['ROLE_ORGANISATION_ADMIN'],
  },
  {
    // « Liste des organisations » promue à la place de l'ancien parent « Gestion des
    // Organisations » (sous-menu supprimé, ainsi que « Ajouter une organisation »).
    id: 'organisations',
    title: 'Organisations',
    icon: 'fas fa-building',
    route: '/admin/organisations/liste',
    type: 'link',
    description: 'Voir toutes les organisations',
    roles: SUPER_OR_SYSTEME,
  },
  {
    id: 'organismes',
    title: 'Organismes',
    icon: 'fas fa-sitemap',
    route: '/admin/organismes',
    type: 'submenu',
    description: 'Organismes premier & deuxième niveau (en-tête des rapports)',
    roles: SUPER_OR_SYSTEME,
    children: [
      {
        id: 'organismes-niveau1',
        title: 'Premier niveau',
        icon: 'fas fa-landmark',
        route: '/admin/organismes/niveau1',
        type: 'link',
        description: 'Organismes centraux (ex. ANCFCC)',
        roles: SUPER_OR_SYSTEME,
      },
      {
        id: 'organismes-niveau2',
        title: 'Deuxième niveau',
        icon: 'fas fa-building',
        route: '/admin/organismes/niveau2',
        type: 'link',
        description: 'Entités décentralisées rattachées',
        roles: SUPER_OR_SYSTEME,
      }
    ]
  },
  {
    id: 'projets',
    title: 'Projets',
    icon: 'fas fa-project-diagram',
    route: '/admin/projets',
    type: 'link',
    description: 'Projets, propriétés, affaires, SSDGPS & sessions',
    roles: ALL_ADMIN_ROLES,
  },
  {
    id: 'parametres',
    title: 'Paramètres',
    icon: 'fas fa-sliders-h',
    route: '/admin/parametres',
    type: 'submenu',
    description: 'Préférences d\'affichage des pièces (tri + colonnes)',
    roles: ALL_ADMIN_ROLES,
    children: [
      {
        id: 'tri-pieces',
        title: 'Tri des pièces',
        icon: 'fas fa-sort-amount-down',
        route: '/admin/parametres/tri-pieces',
        type: 'link',
        description: 'Champ de tri par défaut des tableaux de pièces (affichage + rapport PDF)',
        roles: ALL_ADMIN_ROLES,
      },
      {
        id: 'champs-pieces',
        title: 'Champs par défaut',
        icon: 'fas fa-table-columns',
        route: '/admin/parametres/champs-pieces',
        type: 'link',
        description: 'Colonnes affichées par type de pièce (vues app + rapport PDF)',
        roles: ALL_ADMIN_ROLES,
      },
      {
        id: 'descriptions-champs',
        title: 'Descriptions des champs',
        icon: 'fas fa-circle-info',
        route: '/admin/parametres/descriptions-champs',
        type: 'link',
        description: 'Descriptions & infobulles des champs (communes, aide à l\'import)',
        roles: SUPER_OR_SYSTEME,
      }
    ]
  },
  {
    id: 'utilisateurs',
    title: 'Utilisateurs & Rôles',
    icon: 'fas fa-users-cog',
    route: '/admin/utilisateurs',
    type: 'link',
    description: 'Gestion des utilisateurs et permissions',
    roles: ALL_ADMIN_ROLES,
    children: [
      {
        id: 'liste-utilisateurs',
        title: 'Liste des utilisateurs',
        icon: 'fas fa-users',
        route: '/admin/utilisateurs/liste',
        type: 'link',
        description: 'Tous les utilisateurs',
        roles: ALL_ADMIN_ROLES,
      },
      {
        id: 'roles-permissions',
        title: 'Rôles & Permissions',
        icon: 'fas fa-user-shield',
        route: '/admin/utilisateurs/roles',
        type: 'link',
        description: 'Configuration RBAC',
        roles: ALL_ADMIN_ROLES,
      }
    ]
  },
  {
    // Espace de stockage promu en entrée de premier niveau (ex-sous-entrée de « Gestion des Quotas »).
    id: 'stockage',
    title: 'Espace de stockage',
    icon: 'fas fa-hdd',
    route: '/admin/quotas/stockage',
    type: 'link',
    description: 'Gestion du stockage',
    roles: SUPER_OR_SYSTEME,
  }
];
