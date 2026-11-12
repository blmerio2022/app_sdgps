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
