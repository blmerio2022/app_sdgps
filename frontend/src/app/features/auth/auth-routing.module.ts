import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {LoginComponent} from './components/login/login.component';
import {ForgotPasswordComponent} from './components/forgot-password/forgot-password.component';
import {VerifyCodeComponent} from './components/verify-code/verify-code.component';
import {ResetPasswordComponent} from './components/reset-password/reset-password.component';
import {ChangePasswordComponent} from './components/change-password/change-password.component';

// Définition des routes spécifiques au module d'authentification.
// Aucune route d'inscription : un compte n'est créé que par le Super Admin ou l'Admin
// Système depuis l'administration des utilisateurs.
export const routes: Routes = [
    {
        path: 'login',
        component: LoginComponent
    },
    {
        path: 'forgot-password',
        component: ForgotPasswordComponent
    },
    {
        path: 'verify-code',
        component: VerifyCodeComponent
    },
    {
        path: 'reset-password',
        component: ResetPasswordComponent
    },
    {
        path: 'change-password',
        component: ChangePasswordComponent
    },
    {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full'
    }
];

@NgModule({
    // Importe RouterModule.forChild() pour les modules de fonctionnalités
    // Cela enregistre les routes sans interférer avec les routes racines
    imports: [RouterModule.forChild(routes)],
    // Exporte RouterModule pour que les routes soient disponibles pour le module parent
    exports: [RouterModule]
})
export class AuthRoutingModule {
}
