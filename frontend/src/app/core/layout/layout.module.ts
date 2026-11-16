import { VersionModule } from '../version/version.module';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

// Components
import { DashboardLayoutComponent } from './components/dashboard-layout/dashboard-layout.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TopBarComponent } from './components/topbar/topbar.component';
import { NotificationBellComponent } from './components/notification-bell/notification-bell.component';
import { RechercheGlobaleComponent } from './components/recherche-globale/recherche-globale.component';

// Directives
import { ClickOutsideDirective } from './directives/click-outside.directive';

// Services
import { LayoutService } from './services/layout.service';

import { SharedModule } from '../../shared/shared.module';

@NgModule({
  declarations: [
    DashboardLayoutComponent,
    SidebarComponent,
    TopBarComponent,
    NotificationBellComponent,
    RechercheGlobaleComponent,
    ClickOutsideDirective
  ],
  imports: [
    CommonModule,    // ← Nécessaire pour *ngIf, *ngFor, async pipe
    RouterModule,    // ← Nécessaire pour routerLink, router-outlet
    FormsModule,
    VersionModule,   // Version déployée en bas du menu
    SharedModule     // Assistant IA (bouton flottant, inerte sans IA activée)
  ],
  exports: [
    DashboardLayoutComponent,
    SidebarComponent,
    TopBarComponent
  ],
  providers: [
    LayoutService
  ]
})
export class LayoutModule { }
