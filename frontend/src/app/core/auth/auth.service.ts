import {Injectable} from '@angular/core';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {BehaviorSubject, Observable, throwError} from 'rxjs';
import {catchError, map, tap} from 'rxjs/operators';
import {AuthResponse, UserRole} from '../../features/auth/models/user.model'; // Assurez-vous que le chemin est correct
import {environment} from '../../../environments/environment';

/**
 * @constant API_URL
 * @description URL de base de l'API d'authentification, dérivée de `environment.apiUrl`
 *              (même origine en production, port du backend en développement).
 */
const API_URL = `${environment.apiUrl}/auth`;

/**
 * @injectable
 * @description Service de gestion de l'authentification.
 *              Centralise la logique de connexion, d'inscription et de déconnexion.
 *              Gère le token d'authentification et l'état de connexion de l'utilisateur.
 */
@Injectable({
    providedIn: 'root'
})
export class AuthService {
    // BehaviorSubject pour suivre l'état de connexion de l'utilisateur
    // Initialisé à false (non connecté)
    private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
    isAuthenticated$ = this.isAuthenticatedSubject.asObservable(); // Observable public pour les composants

    // Informations d'organisation et rôle extraits du token
    private organizationId: string | null = null;
    private userRole: UserRole | null = null;
    private userId: number | null = null;

    constructor(private http: HttpClient) {
        // Pourquoi: Vérifier l'état de connexion au démarrage du service
        // pour maintenir la session si un token est déjà présent (ex: après un rechargement de page).
        this.checkAuthStatus();
    }

    // Aucune méthode d'inscription : il n'existe pas d'endpoint public de création de
    // compte. Un compte est créé par le Super Admin ou l'Admin Système via
    // `UserService.createUser()` (POST /api/v1/users/).

    /**
     * @method login
     * @param credentials Les identifiants de connexion de l'utilisateur (email, password).
     * @returns Observable<AuthResponse> La réponse du backend après la connexion.
     * @description Envoie les identifiants de connexion au backend Django.
     *              Stocke le token d'authentification en cas de succès et met à jour l'état.
     *              Extrait les informations d'organisation et de rôle du token JWT.
     *              Vérifie si l'utilisateur doit changer son mot de passe.
     */
    login(credentials: any): Observable<AuthResponse> {
        return this.http.post<AuthResponse>(`${API_URL}/login/`, credentials).pipe(
            tap(response => {
                if (response && response.token) {
                    this.storeAuthToken(response.token);
                    if (response.refresh_token) {
                        localStorage.setItem('refreshToken', response.refresh_token);
                    }
                    this.extractOrganizationInfo(response.token);
                    this.isAuthenticatedSubject.next(true);
                    this.checkPasswordChangeRequired(response.token);
                }
            }),
            catchError(this.handleError)
        );
    }

    refreshToken(): Observable<string> {
        const refresh = localStorage.getItem('refreshToken');
        if (!refresh) {
            return throwError(() => new Error('Aucun refresh token disponible'));
        }
        return this.http.post<{access: string}>(`${API_URL}/token/refresh/`, {refresh}).pipe(
            map(response => {
                this.storeAuthToken(response.access);
                this.extractOrganizationInfo(response.access);
                return response.access;
            }),
            catchError(err => {
                this.logout();
                return throwError(() => err);
            })
        );
    }

    /**
     * @method forgotPassword
     * @param email L'email de l'utilisateur qui a oublié son mot de passe.
     * @returns Observable<any> La réponse du backend.
     * @description Demande un code de réinitialisation de mot de passe.
     */
    forgotPassword(email: string): Observable<any> {
        return this.http.post(`${API_URL}/forgot-password/`, {email}).pipe(
            catchError(this.handleError)
        );
    }

    /**
     * @method verifyResetCode
     * @param email L'email de l'utilisateur.
     * @param code Le code de vérification.
     * @returns Observable<any> La réponse du backend avec un token.
     * @description Vérifie le code de réinitialisation.
     */
    verifyResetCode(email: string, code: string): Observable<any> {
        return this.http.post(`${API_URL}/verify-code/`, {email, code}).pipe(
            catchError(this.handleError)
        );
    }

    /**
     * @method resetPassword
     * @param email L'email de l'utilisateur.
     * @param token Le token de réinitialisation.
     * @param newPassword Le nouveau mot de passe.
     * @returns Observable<any> La réponse du backend.
     * @description Réinitialise le mot de passe de l'utilisateur.
     */
    resetPassword(email: string, token: string, newPassword: string): Observable<any> {
        return this.http.post(`${API_URL}/reset-password/`, {
            email,
            token,
            new_password: newPassword
        }).pipe(
            catchError(this.handleError)
        );
    }

    /**
     * @method changePassword
     * @param data Les données de changement de mot de passe (current_password, new_password).
     * @returns Observable<any> La réponse du backend.
     * @description Change le mot de passe de l'utilisateur authentifié.
     *              Utilisé pour la première connexion (forçage) ou changement volontaire.
     *              IMPORTANT: Envoie le token JWT dans les headers pour l'authentification.
     *              Après succès, déconnecte l'utilisateur pour forcer la reconnexion.
     */
    changePassword(data: { current_password: string; new_password: string }): Observable<any> {
        const token = this.getAuthToken();

        if (!token) {
            console.error('❌ Aucun token JWT trouvé - Authentification impossible');
            return throwError(() => new Error('Utilisateur non authentifié'));
        }

        console.log('🔑 Envoi requête change-password avec token JWT');

        return this.http.post(`${API_URL}/change-password/`, data, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }).pipe(
            tap(response => {
                console.log('✅ Changement MDP réussi:', response);
                // Déconnecter l'utilisateur après changement MDP réussi
                console.log('🚪 Déconnexion utilisateur après changement MDP...');
                this.logout();
            }),
            catchError(this.handleError)
        );
    }

    /**
     * @method logout
     * @description Déconnecte l'utilisateur en supprimant le token d'authentification
     *              et en mettant à jour l'état de connexion. Réinitialise aussi les infos d'organisation.
     */
    logout(): void {
        console.log('🚪 AuthService: Déconnexion utilisateur...');
        
        localStorage.removeItem('authToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        
        // Mettre à jour l'état d'authentification global
        this.isAuthenticatedSubject.next(false);
        
        // Réinitialiser les informations d'organisation
        this.organizationId = null;
        this.userRole = null;
        this.userId = null;
        
        console.log('✅ AuthService: Tokens supprimés, état réinitialisé');
    }

    /**
     * @method getAuthToken
     * @returns string | null Le token d'authentification ou null s'il n'existe pas.
     * @description Récupère le token d'authentification depuis le localStorage.
     */
    getAuthToken(): string | null {
        return localStorage.getItem('authToken');
    }

    /**
     * @method isLoggedIn
     * @returns boolean Vrai si un token est présent, faux sinon.
     * @description Vérifie si l'utilisateur est actuellement connecté en se basant sur la présence du token.
     */
    isLoggedIn(): boolean {
        return !!this.getAuthToken();
    }

    /**
     * @method getOrganizationId
     * @returns string | null L'ID de l'organisation actuelle, ou null.
     * @description Lu depuis le claim `org_id` du JWT, posé à la connexion.
     *              ⚠️ Instantané de la connexion : après un changement d'organisation,
     *              la valeur n'est à jour qu'à la reconnexion. À n'utiliser que pour
     *              l'affichage — jamais comme contrôle d'accès.
     */
    getOrganizationId(): string | null {
        return this.organizationId;
    }

    /**
     * @method storeAuthToken
     * @param token Le token d'authentification à stocker.
     * @description Stocke le token d'authentification dans le localStorage.
     */
    private storeAuthToken(token: string): void {
        // Pourquoi: Le localStorage est un moyen simple de persister le token entre les sessions.
        localStorage.setItem('authToken', token);
    }

    /**
     * @method getUserId
     * @returns number | null L'ID de l'utilisateur connecté ou null.
     */
    getUserId(): number | null {
        return this.userId;
    }

    /**
     * @method getUserRole
     * @returns UserRole | null Le rôle de l'utilisateur ou null.
     * @description Retourne le rôle RBAC de l'utilisateur dans son organisation.
     */
    getUserRole(): UserRole | null {
        return this.userRole;
    }

    // `hasRole`, `isAdmin`, `isManager` et `canAccessOrganization` ont été RETIRÉS :
    // ils comparaient le rôle à « ADMIN » / « MANAGER », qui n'existent pas dans cette
    // application (les rôles sont `ROLE_SUPER_ADMIN`, `ROLE_ADMIN_SYSTEME`,
    // `ROLE_ORGANISATION_ADMIN`, `ROLE_ORGANISATION_AGENT`). Ils renvoyaient donc
    // toujours `false` et aucun appelant ne s'en servait. Pour un test de rôle, lire
    // `getUserRole()` ; la seule barrière qui compte reste le backend.

    /**
     * @method isPlatformAdmin
     * @returns boolean Vrai pour un super-admin ou un App Admin (ROLE_ADMIN_SYSTEME).
     * @description Décode le JWT pour lire `platform_role` / `is_superuser` (le rôle
     *              plateforme n'est pas stocké dans `userRole`). Sert à autoriser l'édition
     *              des réglages COMMUNS (ex. champs obligatoires du catalogue). La vraie
     *              barrière reste côté backend.
     */
    isPlatformAdmin(): boolean {
        const token = localStorage.getItem('authToken');
        if (!token) return false;
        try {
            const p = JSON.parse(atob(token.split('.')[1]));
            return p.is_superuser === true
                || p.platform_role === 'ROLE_SUPER_ADMIN'
                || p.platform_role === 'ROLE_ADMIN_SYSTEME';
        } catch {
            return false;
        }
    }

    /**
     * @method getPostLoginRoute
     * @returns string La route d'atterrissage après connexion selon le rôle.
     * @description Super Admin & Admin Système atterrissent sur le tableau de bord admin
     *              (`/admin/dashboard`, qui rend l'accueil `HomeModule`). Les rôles
     *              d'organisation (Admin/Agent) atterrissent sur `/dashboard` (même HomeModule).
     */
    getPostLoginRoute(): string {
        return this.isPlatformAdmin() ? '/admin/dashboard' : '/dashboard';
    }

    /**
     * @method checkAuthStatus
     * @description Vérifie si un token d'authentification est présent dans le localStorage
     *              pour déterminer si l'utilisateur est déjà connecté. Met à jour le BehaviorSubject
     *              et extrait les informations d'organisation du token.
     */
    private checkAuthStatus(): void {
        const token = localStorage.getItem('authToken');
        // Pourquoi: Mettre à jour l'état d'authentification global de l'application.
        this.isAuthenticatedSubject.next(!!token);

        // Extraire les informations d'organisation si un token existe
        if (token) {
            this.extractOrganizationInfo(token);

            // IMPORTANT: Ne pas vérifier le changement MDP si on est DÉJÀ sur la page change-password
            // pour éviter une boucle infinie de redirection
            const currentPath = window.location.pathname;
            const isOnChangePasswordPage = currentPath.includes('/auth/change-password');

            if (!isOnChangePasswordPage) {
                // Vérifier aussi si changement MDP requis au chargement
                this.checkPasswordChangeRequired(token);
            } else {
                console.log('⚠️  Déjà sur page change-password - Skip vérification pour éviter boucle');
            }
        }
    }

    /**
     * @method extractOrganizationInfo
     * @param token Le token JWT contenant les informations d'organisation et de rôle.
     * @description Extrait et stocke l'ID d'organisation et le rôle utilisateur depuis le payload JWT.
     *              Format attendu: { org_id: "uuid", role: "ADMIN|MANAGER|USER", ... }
     */
    private extractOrganizationInfo(token: string): void {
        try {
            // Décoder le payload JWT (deuxième partie du token)
            const payload = JSON.parse(atob(token.split('.')[1]));

            // Extraire les informations RBAC
            this.organizationId = payload.org_id || payload.organizationId || null;
            this.userRole = payload.role || payload.userRole || null;
            // simplejwt sérialise `user_id` en CHAÎNE. Sans conversion, `getUserId()`
            // renvoyait '1' là où les appelants comparent à un nombre
            // (`Number(user.id) === currentUserId`) : la comparaison était toujours
            // fausse et le garde-fou « c'est moi » de la liste des utilisateurs ne
            // se déclenchait jamais.
            const brut = payload.user_id;
            const numerique = brut === null || brut === undefined ? NaN : Number(brut);
            this.userId = Number.isFinite(numerique) ? numerique : null;

            console.log('RBAC Info extracted:', {
                organizationId: this.organizationId,
                userRole: this.userRole,
                userId: this.userId
            });
        } catch (error) {
            console.error('Erreur lors de l\'extraction des infos RBAC:', error);
            this.organizationId = null;
            this.userRole = null;
        }
    }

    /**
     * @method checkPasswordChangeRequired
     * @param token Le token JWT.
     * @description Vérifie si l'utilisateur doit changer son mot de passe en appelant l'API.
     *              Si oui, redirige vers la page de changement de mot de passe.
     *              Sinon, redirige vers le dashboard.
     *              PROTECTION: Ne redirige pas si déjà sur la page appropriée.
     */
    private checkPasswordChangeRequired(token: string): void {
        // Protection: Vérifier qu'on n'est pas déjà en train de rediriger
        const currentPath = window.location.pathname;

        // Appel API pour vérifier le statut du mot de passe
        this.http.get(`${API_URL}/me/`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }).subscribe({
            next: (userProfile: any) => {
                if (userProfile.must_change_password) {
                    // Si déjà sur la page change-password, ne pas rediriger (évite boucle)
                    if (currentPath.includes('/auth/change-password')) {
                        console.log('✅ Déjà sur page change-password - Pas de redirection');
                        return;
                    }

                    console.log('⚠️  Changement de mot de passe requis - Redirection...');
                    // Rediriger vers la page de changement de mot de passe
                    setTimeout(() => {
                        window.location.href = '/auth/change-password?reason=first_login';
                    }, 100);
                } else {
                    // Redirection uniquement depuis les pages d'auth (post-login). Si on est
                    // déjà sur une page de l'application (toute page hors /auth), ne pas rediriger
                    // — sinon un rafraîchissement sur /projets, /home… renverrait à l'accueil.
                    if (!currentPath.startsWith('/auth')) {
                        console.log('✅ Déjà sur une page de l\'application - Pas de redirection');
                        return;
                    }

                    // Si aucun changement requis, rediriger vers l'accueil selon le rôle
                    // (admin plateforme → /admin/dashboard, sinon → /home).
                    console.log('✅ Connexion réussie - Redirection vers l\'accueil...');
                    const target = this.getPostLoginRoute();
                    setTimeout(() => {
                        window.location.href = target;
                    }, 100);
                }
            },
            error: (err) => {
                console.error('Erreur vérification statut MDP:', err);

                // En cas d'erreur, ne rediriger que depuis une page d'auth (post-login).
                if (currentPath.startsWith('/auth')) {
                    const target = this.getPostLoginRoute();
                    setTimeout(() => {
                        window.location.href = target;
                    }, 100);
                }
            }
        });
    }

    /**
     * @method handleError
     * @param error L'erreur HTTP reçue du backend.
     * @returns Observable<never> Un observable d'erreur.
     * @description Gère les erreurs HTTP de manière centralisée.
     *              Extrait un message d'erreur pertinent et le propage.
     *              PRÉSERVE la structure de l'erreur backend pour le frontend.
     */
    private handleError(error: HttpErrorResponse): Observable<never> {
        let errorMessage = 'Une erreur inconnue est survenue.';
        let errorDetail: any = null;

        if (error.error instanceof ErrorEvent) {
            // Erreur côté client ou réseau
            errorMessage = `Erreur réseau/client: ${error.error.message}`;
            errorDetail = {detail: errorMessage, code: 'NETWORK_ERROR'};
        } else {
            // Erreur côté serveur (le backend a renvoyé un code d'état d'erreur)
            if (error.status === 0) {
                errorMessage = 'Le serveur backend est injoignable. Veuillez vérifier votre connexion ou l\'état du serveur.';
                errorDetail = {detail: errorMessage, code: 'SERVER_UNREACHABLE', status: 0};
            } else if (error.error && typeof error.error === 'object') {
                // Préserver la structure complète de l'erreur backend
                errorDetail = error.error;

                // Extraire le message pour le log
                if (error.error.detail) {
                    errorMessage = error.error.detail;
                } else if (error.error.message) {
                    errorMessage = error.error.message;
                } else {
                    errorMessage = JSON.stringify(error.error);
                }
            } else {
                errorMessage = `Erreur serveur (${error.status}): ${error.message}`;
                errorDetail = {detail: errorMessage, status: error.status};
            }
        }

        console.error('AuthService Error:', errorMessage);
        console.error('AuthService Error Detail:', errorDetail);

        // IMPORTANT: Retourner un objet qui préserve la structure backend
        // au lieu d'un simple Error string
        return throwError(() => {
            const errorObj = new Error(errorMessage);
            // Ajouter les détails backend à l'objet Error
            (errorObj as any).error = errorDetail;
            (errorObj as any).status = error.status;
            return errorObj;
        });
    }
}
