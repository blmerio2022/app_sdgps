import {NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {HTTP_INTERCEPTORS, HttpClientModule} from '@angular/common/http'; // Importe HttpClientModule pour les requêtes HTTP
import {AppRoutingModule} from './app-routing.module'; // Importe le module de routage principal
import {AppComponent} from './app.component'; // Importe le composant racine
import {LayoutModule} from './core/layout/layout.module'; // ← AJOUT: Module Layout (Sidebar, TopBar, etc.)
import {AuthModule} from './features/auth/auth.module';
import {VersionModule} from './core/version/version.module'; // ← AJOUT: Module Auth (Login, Register, etc.)
import {DashboardModule} from './features/dashboard/dashboard.module'; // ← AJOUT: Module Dashboard
import {UsersModule} from './features/admin/users/users.module'; // ← AJOUT: Module Users
import {OrganismesModule} from './features/admin/organismes/organismes.module'; // ← AJOUT: Module Organismes
import {PieceFieldDescriptionsModule} from './features/admin/piece-field-descriptions/piece-field-descriptions.module'; // ← Descriptions des champs de pièces (App Admin)
import {StorageDashboardModule} from './features/admin/storage/storage-dashboard.module'; // ← Dashboard stockage (App Admin)
import {StorageQuotasModule} from './features/admin/storage-quotas/storage-quotas.module'; // ← Quotas de stockage (Super Admin)
import {ToastrModule} from 'ngx-toastr';
import {AuthInterceptor} from './core/interceptors/auth.interceptor';

@NgModule({
    declarations: [
        AppComponent // Déclare le composant racine
    ],
    imports: [
        BrowserModule, // Module nécessaire pour faire fonctionner l'application Angular dans un navigateur
        BrowserAnimationsModule, // Requis pour les animations (ngx-toastr)
        AppRoutingModule, // Importe les routes principales de l'application
        HttpClientModule, // Permet d'utiliser le service HttpClient pour les appels API
        LayoutModule, // ← AJOUT: Dashboard layout components
        AuthModule, // ← AJOUT: Authentication components
        VersionModule, // Version déployée + bandeau « nouvelle version »
        DashboardModule, // ← AJOUT: Dashboard components (OrganizationList, etc.)
        UsersModule, // ← AJOUT: User management components
        OrganismesModule, // ← AJOUT: Organismes premier/deuxième niveau
        PieceFieldDescriptionsModule, // ← AJOUT: Descriptions des champs de pièces (App Admin)
        StorageDashboardModule, // ← AJOUT: Dashboard stockage (App Admin)
        StorageQuotasModule, // ← AJOUT: Quotas de stockage par organisation (Super Admin)
        ToastrModule.forRoot({
          timeOut: 3000,
          positionClass: 'toast-bottom-right', // ← Position en bas à droite
          preventDuplicates: true,
          progressBar: true,
          progressAnimation: 'increasing',
          closeButton: true
        })
    ],
    providers: [
      // Enregistrer l'interceptor JWT
      {
        provide: HTTP_INTERCEPTORS,
        useClass: AuthInterceptor,
        multi: true
      }
    ], // Les services globaux peuvent être enregistrés ici
    bootstrap: [AppComponent] // Le composant racine à démarrer
})
export class AppModule {
}
