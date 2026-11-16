import {Component, OnInit} from '@angular/core';
import {FormBuilder, FormGroup, Validators} from '@angular/forms';
import {AuthService} from '../../../../core/auth/auth.service'; // Ajuste le chemin si nécessaire
import {Router} from '@angular/router'; // Pour la redirection après connexion
import {LayoutService} from '../../../../core/layout/services/layout.service'; // Bascule thème clair/sombre

@Component({
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
    // Déclaration du groupe de formulaire pour la connexion
    loginForm!: FormGroup;
    // Message d'erreur à afficher en cas de problème lors de la connexion
    errorMessage: string = '';
    // Indicateur de chargement pour l'expérience utilisateur
    isLoading: boolean = false;

    // Contrôle de visibilité du mot de passe
    showPassword: boolean = false;

    /** 2e étape (double authentification) : jeton signé reçu après le mot de passe. */
    jetonMfa: string | null = null;
    codeMfa = '';

    constructor(
        private fb: FormBuilder, // Injecte FormBuilder pour créer des contrôles de formulaire
        private authService: AuthService, // Injecte AuthService pour la logique d'authentification
        private router: Router, // Injecte Router pour la navigation
        public layout: LayoutService // Bascule de thème (applique aussi le thème sauvegardé)
    ) {
    }

    ngOnInit(): void {
        // Initialisation du formulaire réactif avec les champs et leurs validateurs
        this.loginForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]], // Email : requis et format email valide
            password: ['', [Validators.required, Validators.minLength(6)]] // Mot de passe : requis, min 6 caractères
        });
    }

    /**
     * @description Bascule la visibilité du mot de passe
     */
    togglePasswordVisibility(): void {
        this.showPassword = !this.showPassword;
    }

    /** Valide le code de l'application d'authentification (ou un code de secours). */
    validerCode(): void {
        if (!this.jetonMfa || !this.codeMfa.trim() || this.isLoading) return;
        this.isLoading = true;
        this.errorMessage = '';
        this.authService.loginMfa(this.jetonMfa, this.codeMfa.trim()).subscribe({
            next: () => { this.isLoading = false; },
            error: (err) => {
                this.isLoading = false;
                const code = err?.error?.code;
                if (code === 'MFA_EXPIRED') {
                    this.annulerMfa();
                    this.errorMessage = 'Étape expirée : reconnectez-vous.';
                } else if (code === 'ACCOUNT_LOCKED') {
                    this.annulerMfa();
                    this.errorMessage = 'Trop de codes refusés : compte temporairement verrouillé.';
                } else {
                    const reste = err?.error?.remaining_attempts;
                    this.errorMessage = 'Code incorrect.' + (reste !== undefined ? ` Tentatives restantes : ${reste}.` : '');
                }
            },
        });
    }

    annulerMfa(): void { this.jetonMfa = null; this.codeMfa = ''; }

    /**
     * @description Méthode appelée lors de la soumission du formulaire de connexion.
     * Gère la validation du formulaire et l'appel au service d'authentification.
     */
    onSubmit(): void {
        // Réinitialise le message d'erreur et active l'indicateur de chargement
        this.errorMessage = '';
        this.isLoading = true;

        // Vérifie si le formulaire est valide avant de procéder
        if (this.loginForm.valid) {
            // Appel au service d'authentification pour la connexion
            this.authService.login(this.loginForm.value).subscribe({
                next: (response) => {
                    // Désactive l'indicateur de chargement
                    this.isLoading = false;
                    if (response?.mfa_requis && response.jeton_mfa) {
                        this.jetonMfa = response.jeton_mfa;   // → étape « code »
                        this.codeMfa = '';
                        return;
                    }

                    // NOTE: La redirection est gérée par AuthService.checkPasswordChangeRequired()
                    // Si must_change_password = true → /auth/change-password
                    // Sinon → /dashboard
                    // On ne fait rien ici, le service s'en charge
                },
                error: (err) => {
                    // Gère les erreurs de connexion (ex: identifiants invalides, erreur serveur)
                    console.error('Erreur lors de la connexion', err);

                    // Afficher des messages d'erreur explicites selon le code d'erreur
                    if (err.error?.code === 'EMAIL_NOT_FOUND') {
                        // Email n'existe pas
                        this.errorMessage = `❌ ${err.error.message}`;
                    } else if (err.error?.code === 'INVALID_PASSWORD') {
                        // Mot de passe incorrect
                        this.errorMessage = `🔑 ${err.error.message}`;
                    } else if (err.error?.message) {
                        // Message personnalisé du backend
                        this.errorMessage = err.error.message;
                    } else if (err.error?.detail) {
                        // Message detail du backend
                        this.errorMessage = err.error.detail;
                    } else {
                        // Message par défaut
                        this.errorMessage = 'Identifiants invalides. Veuillez réessayer.';
                    }
                    
                    // Désactive l'indicateur de chargement
                    this.isLoading = false;
                }
            });
        } else {
            // Si le formulaire n'est pas valide, marque tous les champs comme "touchés" pour afficher les messages d'erreur
            this.loginForm.markAllAsTouched();
            // Affiche un message d'erreur général
            this.errorMessage = 'Veuillez remplir tous les champs correctement.';
            // Désactive l'indicateur de chargement
            this.isLoading = false;
        }
    }

    /**
     * @description Méthode utilitaire pour vérifier si un champ de formulaire est invalide et a été touché ou modifié.
     * @param controlName Le nom du contrôle de formulaire.
     * @returns Vrai si le champ doit afficher une erreur, faux sinon.
     */
    shouldShowError(controlName: string): boolean {
        const control = this.loginForm.get(controlName);
        return !!control && control.invalid && (control.dirty || control.touched);
    }
}
