import { NgModule, Component } from '@angular/core';
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

// Composant placeholder temporaire (à remplacer par vos vrais composants)
@Component({
  template: '<div style="padding: 20px;"><h2>{{ title }}</h2><p>Ce module est en cours de développement.</p></div>'
})
export class PlaceholderComponent {
  title = '';
}

const routes: Routes = [
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
        path: 'organisations',
        component: PlaceholderComponent,
        data: { title: 'Gestion des Organisations' }
      },
      {
        path: 'organisations/liste',
        component: OrganizationListComponent,
        data: { title: 'Liste des Organisations' }
      },
      {
        path: 'organisations/ajouter',
        component: PlaceholderComponent,
        data: { title: 'Ajouter une Organisation' }
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
        path: 'utilisateurs/invitations',
        component: PlaceholderComponent,
        data: { title: 'Invitations' }
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
        path: 'logs-audit',
        component: PlaceholderComponent,
        data: { title: 'Logs d\'Audit' }
      },
      {
        path: 'supervision',
        component: PlaceholderComponent,
        data: { title: 'Supervision Système' }
      },
      {
        path: 'supervision/health',
        component: PlaceholderComponent,
        data: { title: 'Health Check' }
      },
      {
        path: 'supervision/stats',
        component: PlaceholderComponent,
        data: { title: 'Statistiques' }
      },
      {
        path: 'quotas',
        component: PlaceholderComponent,
        data: { title: 'Gestion des Quotas' }
      },
      {
        path: 'quotas/stockage',
        component: StorageDashboardComponent,
        data: { title: 'Espace de stockage' }
      },
      {
        path: 'quotas/limites',
        component: PlaceholderComponent,
        data: { title: 'Limites projets' }
      },
      {
        path: 'maintenance',
        component: PlaceholderComponent,
        data: { title: 'Mode Maintenance' }
      },
      {
        path: 'projets',
        loadChildren: () => import('./features/projects/projects.module').then(m => m.ProjectsModule),
        data: { title: 'Projets' }
      },
      {
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.module').then(m => m.ProfileModule),
        data: { title: 'Mon Profil' }
      },
      {
        path: 'test-profile',
        component: TestProfileRouteComponent,
        data: { title: 'Test Route Profile' }
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
        path: 'mes-projets',
        component: PlaceholderComponent,
        data: { title: 'Mes Projets' }
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
