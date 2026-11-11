/**
 * @type UserRole
 * @description Définit les rôles RBAC disponibles dans le système multi-organisations.
 *              Hiérarchie: ADMIN > MANAGER > USER
 */
export type UserRole = 'ADMIN' | 'MANAGER' | 'USER';

/**
 * @interface User
 * @description Représente la structure des données d'un utilisateur pour l'inscription et potentiellement d'autres opérations.
 *              Utilisée pour assurer le typage fort et la clarté du code.
 *              Supporte maintenant l'architecture RBAC multi-organisations.
 */
export interface User {
    first_name: string;   // Prénom (champ Django standard)
    last_name: string;    // Nom (champ Django standard)
    nomSociete?: string; // Optionnel, car toutes les inscriptions ne sont pas forcément liées à une société
    email: string;
    password?: string; // Optionnel car le mot de passe n'est pas toujours renvoyé par l'API après inscription/connexion
    organizationId?: string; // ID de l'organisation (RBAC)
    role?: UserRole; // Rôle RBAC de l'utilisateur
}

// Pas de `RegisterPayload` : l'inscription publique n'existe pas. La création de compte
// passe par `CreateUserPayload` (core/models/user.model.ts), réservée à l'administration
// de l'application.

/**
 * @interface AuthResponse
 * @description Représente la structure de la réponse attendue du backend après une opération d'authentification (connexion/inscription).
 *              Contient généralement un token d'authentification et/ou des informations sur l'utilisateur.
 */
export interface AuthResponse {
    token: string;
    refresh_token?: string;
    user: User;
}
