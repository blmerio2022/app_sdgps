import { VersionModule } from '../../core/version/version.module';
import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ReactiveFormsModule} from '@angular/forms';

import {AuthRoutingModule} from './auth-routing.module';
import {LoginComponent} from './components/login/login.component';
import {ForgotPasswordComponent} from './components/forgot-password/forgot-password.component';
import {VerifyCodeComponent} from './components/verify-code/verify-code.component';
import {ResetPasswordComponent} from './components/reset-password/reset-password.component';
import {ChangePasswordComponent} from './components/change-password/change-password.component';


@NgModule({
    declarations: [
        LoginComponent,
        ForgotPasswordComponent,
        VerifyCodeComponent,
        ResetPasswordComponent,
        ChangePasswordComponent
    ],
    imports: [
        CommonModule, // Fournit les directives Angular communes comme *ngIf, *ngFor
        AuthRoutingModule, // Importe les routes définies pour l'authentification
        ReactiveFormsModule, // Permet l'utilisation des formulaires réactifs
        VersionModule // Version déployée en pied de la page de connexion
    ]
})
export class AuthModule {
}
