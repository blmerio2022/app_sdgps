import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardLayoutComponent } from './core/layout/components/dashboard-layout/dashboard-layout.component';
import { AdminGuard } from './core/guards/admin.guard';
import { TestProfileRouteComponent } from './features/test-profile-route.component';
import { OrganizationListComponent } from './features/dashboard/organization-list/organization-list.component';
import { UserListComponent } from './features/admin/users/user-list/user-list.component';
import { UserDetailComponent } from './features/admin/users/user-detail/user-detail.component';
import { RolesPermissionsComponent } from './features/admin/users/roles-permissions/roles-permissions.component';
import { OrganismeListComponent } from './features/admin/organismes/organisme-list/organisme-list.component';
import { PieceFieldDescriptionsComponent } from './features/admin/piece-field-descriptions/piece-field-descriptions.component';
import { StorageDashboardComponent } from './features/admin/storage/storage-dashboard.component';
import { StorageQuotasComponent } from './features/admin/storage-quotas/storage-quotas.component';

// Aucune route « en cours de développement » : une entrée de menu qui mène à une page
// vide est pire qu'une entrée absente. Les modules à venir seront routés le jour où ils
// existeront ; en attendant, une URL inconnue retombe sur le tableau de bord (`**`).
//
// ⚠️ Le groupe OPÉRATEUR (`path: ''`) et la route `dashboard` des deux groupes sont la
// destination de toute l'application authentifiée : `getPostLoginRoute()` y mène après
// la connexion, et les deux `**` y redirigent. Les retirer rend l'application
// inatteignable une fois connecté — écran vide, sans message.

// Exporté pour être VÉRIFIABLE : `app-routing.module.spec.ts` contrôle que le groupe
// opérateur et les tableaux de bord existent toujours. Une suppression de route ne
// casse aucun test de composant — elle ne se voit qu'à l'exécution, écran vide.
export const routes: Routes = [
  {
    path: '',
    redirectTo: '/auth/login',
    pathMatch: 'full'
  },

  // Routes Authentification (DOIVENT être avant le catch-all)
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.module').then(m => m.AuthModule)
  },

  // Routes Admin (protégées par guard) — déclarées AVANT le groupe opérateur (path '')
  // afin d'être appariées en priorité (un groupe à path vide masquerait sinon /admin/**).
  {
    path: 'admin',
    component: DashboardLayoutComponent,
    canActivate: [AdminGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        // Tableau de bord admin (Super Admin / Admin Système) : réutilise l'accueil
        // opérateur (`HomeModule` : KPI + projets récents). Voir aussi la redirection
        // post-login `getPostLoginRoute()` dans AuthService.
        path: 'dashboard',
        loadChildren: () => import('./features/home/home.module').then(m => m.HomeModule),
        data: { title: 'Tableau de bord' }
      },
      {
        path: 'organisations/liste',
        component: OrganizationListComponent,
        data: { title: 'Liste des Organisations' }
      },
      {
        path: 'organismes/niveau1',
        component: OrganismeListComponent,
        data: { title: 'Organismes — premier niveau', niveau: 1 }
      },
      {
        path: 'organismes/niveau2',
        component: OrganismeListComponent,
        data: { title: 'Organismes — deuxième niveau', niveau: 2 }
      },
      {
        // Paramètres → Descriptions des champs de pièces (App Admin uniquement).
        // NB : doit rester AVANT le module `parametres` (route exacte prioritaire).
        path: 'parametres/descriptions-champs',
        component: PieceFieldDescriptionsComponent,
        data: { title: 'Descriptions des champs de pièces' }
      },
      {
        // Paramètres (tri + champs des pièces) — sorti de `profile/` pour ne plus afficher
        // « Mon profil » dans le fil d'Ariane. URL : /admin/parametres/…
        path: 'parametres',
        loadChildren: () => import('./features/parametres/parametres.module').then(m => m.ParametresModule),
        data: { title: 'Paramètres' }
      },
      {
        path: 'utilisateurs',
        pathMatch: 'full',
        component: UserListComponent,
        data: { title: 'Gestion des Utilisateurs' }
      },
      {
        path: 'utilisateurs/liste',
        component: UserListComponent,
        data: { title: 'Liste des Utilisateurs' }
      },
      {
        path: 'utilisateurs/roles',
        component: RolesPermissionsComponent,
        data: { title: 'Rôles et Permissions' }
      },
      {
        path: 'utilisateurs/:id',
        component: UserDetailComponent,
        data: { title: 'Détail Utilisateur' }
      },
      {
        path: 'roles-permissions',
        component: RolesPermissionsComponent,
        data: { title: 'Rôles et Permissions' }
      },
      {
        path: 'quotas/stockage',
        component: StorageDashboardComponent,
        data: { title: 'Espace de stockage' }
      },
      {
        path: 'quotas/limites',
        component: StorageQuotasComponent,
        data: { title: 'Quotas de stockage' }
      },
      {
        // Feature Projets (Phase 5) accessible aux Agents d'organisation.
        path: 'projets',
        loadChildren: () => import('./features/projects/projects.module').then(m => m.ProjectsModule),
        data: { title: 'Projets' }
      },
      {
        // Réseau de triangulation GPS — module indépendant, ouvert à TOUS les rôles.
        path: 'reseau-gps',
        loadChildren: () => import('./features/reseau-gps/reseau-gps.module').then(m => m.ReseauGpsModule),
        data: { title: 'Réseau GPS' }
      },
      {
        // Profil accessible à TOUT opérateur authentifié (hors AdminGuard).
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.module').then(m => m.ProfileModule),
        data: { title: 'Mon Profil' }
      },
      {
        path: 'test-profile',
        component: TestProfileRouteComponent,
        data: { title: 'Test Route Profile' }
      },
      {
        // Sous-chemin admin inconnu → tableau de bord.
        path: '**',
        redirectTo: 'dashboard'
      }
    ]
  },

  // Routes Opérateur d'organisation — servies à la RACINE (sans préfixe « dashboard »).
  {
    path: '',
    component: DashboardLayoutComponent,
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        // Tableau de bord opérateur (KPI + projets récents) — Admin & Agent d'organisation.
        // NB : /admin/dashboard (super-admin / admin système) rend le même HomeModule.
        path: 'dashboard',
        loadChildren: () => import('./features/home/home.module').then(m => m.HomeModule),
        data: { title: 'Tableau de bord' }
      },
      {
        // Ancienne URL de l'accueil opérateur → /dashboard (compat liens/redirections).
        path: 'home',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        // Feature Projets (Phase 5) accessible aux Agents d'organisation.
        path: 'projets',
        loadChildren: () => import('./features/projects/projects.module').then(m => m.ProjectsModule),
        data: { title: 'Projets' }
      },
      {
        // Profil accessible à TOUT opérateur authentifié (hors AdminGuard).
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.module').then(m => m.ProfileModule),
        data: { title: 'Mon Profil' }
      },
      {
        // Réseau de triangulation GPS — module indépendant, ouvert à TOUS les rôles.
        path: 'reseau-gps',
        loadChildren: () => import('./features/reseau-gps/reseau-gps.module').then(m => m.ReseauGpsModule),
        data: { title: 'Réseau GPS' }
      },
      {
        // Paramètres (tri + champs des pièces) — URL /parametres/… (sans « profile/ »).
        path: 'parametres',
        loadChildren: () => import('./features/parametres/parametres.module').then(m => m.ParametresModule),
        data: { title: 'Paramètres' }
      },
      {
        // Sous-chemin opérateur inconnu → tableau de bord (évite de dépendre du backtracking du path vide).
        path: '**',
        redirectTo: 'dashboard'
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
