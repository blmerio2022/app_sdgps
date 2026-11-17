import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { estRefusQuota, messageRefusQuota } from '../../../../core/services/stockage.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { LayoutService } from '../../../../core/layout/services/layout.service';
import { PasswordValidationService, PasswordCriterion } from '../../../../core/services/password-validation.service';
import { Subscription } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-profile-settings',
  templateUrl: './profile-settings.component.html',
  styleUrls: ['./profile-settings.component.scss']
})
export class ProfileSettingsComponent implements OnInit, OnDestroy {
  
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  
  profileForm!: FormGroup;
  passwordForm!: FormGroup;
  userProfile: UserProfile | null = null;
  isLoading = false;
  isPasswordLoading = false;
  showPasswordModal = false;
  isUploadingPhoto = false;  // ← AJOUT: État upload photo

  // Enregistrement automatique des informations personnelles (comme les pages de tri /
  // config des champs) : indicateur au lieu d'un bouton « Sauvegarder ».
  savingProfile = false;
  profileSavedFlash = false;
  private profileSaveTimer: any = null;

  // Modale de confirmation de suppression de la photo de profil.
  showDeletePhotoModal = false;

  /** Formats d'image acceptés pour la photo de profil (extensions, minuscules). */
  readonly allowedPhotoExtensions = ['jpg', 'jpeg', 'png', 'gif', 'tiff', 'tif', 'webp'];
  /** Libellé lisible des formats acceptés (hint + messages). */
  readonly allowedPhotoLabel = 'JPG, JPEG, PNG, GIF, TIFF, WebP';
  
  // Contrôle de visibilité des mots de passe
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;
  
  // Critères de validation du mot de passe
  passwordCriteria: PasswordCriterion[] = [];

  private subscriptions = new Subscription();

  constructor(
    private fb: FormBuilder,
    private profileService: ProfileService,
    public layoutService: LayoutService,
    private passwordValidationService: PasswordValidationService,
    private toastr: ToastrService,
  ) {}
  
  ngOnInit(): void {
    console.log('🚀 ProfileSettingsComponent initialisé');
    this.initForms();
    this.loadProfile();
    this.subscribeToProfileUpdates();

    // Enregistrement automatique (anti-rebond) à chaque modification saisie.
    this.subscriptions.add(
      this.profileForm.valueChanges.subscribe(() => this.queueProfileAutoSave())
    );

    // Initialiser les critères de mot de passe
    this.passwordCriteria = this.passwordValidationService.getCriteria();
    
    // Écouter les changements du nouveau mot de passe pour validation en temps réel
    this.passwordForm.get('new_password')?.valueChanges.subscribe(value => {
      this.passwordCriteria = this.passwordValidationService.validatePassword(value || '');
    });
  }
  
  ngOnDestroy(): void {
    clearTimeout(this.profileSaveTimer);
    this.subscriptions.unsubscribe();
  }
  
  /**
   * Initialise les formulaires réactifs
   */
  private initForms(): void {
    // Formulaire profil
    this.profileForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: [{ value: '', disabled: true }]
    });
    
    // Formulaire mot de passe
    this.passwordForm = this.fb.group({
      current_password: ['', [Validators.required]],
      new_password: ['', [
        Validators.required,
        Validators.minLength(8),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
      ]],
      confirm_password: ['', [Validators.required]]
    }, {
      validators: this.passwordMatchValidator
    });
  }
  
  /**
   * Charge le profil utilisateur
   */
  loadProfile(): void {
    this.isLoading = true;
    
    this.subscriptions.add(
      this.profileService.getProfile().subscribe({
        next: (profile) => {
          this.userProfile = profile;
          this.patchFormValues(profile);
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Erreur chargement profil:', error);
          this.toastr.error('Erreur lors du chargement du profil', 'Erreur');
          this.isLoading = false;
        }
      })
    );
  }
  
  /**
   * Remplit le formulaire avec les données du profil
   */
  private patchFormValues(profile: UserProfile): void {
    // `emitEvent: false` : le pré-remplissage ne doit PAS déclencher l'enregistrement
    // automatique (qui n'écoute que les modifications saisies par l'utilisateur).
    this.profileForm.patchValue({
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email
    }, { emitEvent: false });
  }
  
  /**
   * S'abonne aux mises à jour du profil
   */
  private subscribeToProfileUpdates(): void {
    this.subscriptions.add(
      this.profileService.onProfileUpdated().subscribe(profile => {
        if (profile) {
          this.userProfile = profile;
          this.patchFormValues(profile);
        }
      })
    );
  }
  
  /**
   * Validateur personnalisé: vérifie que les mots de passe correspondent
   */
  passwordMatchValidator(form: FormGroup): any {
    const newPassword = form.get('new_password')?.value;
    const confirmPassword = form.get('confirm_password')?.value;
    
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      return { passwordMismatch: true };
    }
    
    return null;
  }
  
  /** Programme un enregistrement automatique (anti-rebond) après une modification saisie. */
  private queueProfileAutoSave(): void {
    clearTimeout(this.profileSaveTimer);
    this.profileSaveTimer = setTimeout(() => this.autoSaveProfile(), 700);
  }

  /**
   * Enregistre automatiquement les informations personnelles. Un formulaire invalide n'est
   * pas envoyé (l'indicateur reste au repos et les messages d'erreur de champ s'affichent).
   */
  private autoSaveProfile(): void {
    if (this.profileForm.invalid) return;

    this.savingProfile = true;
    const formData = this.profileForm.getRawValue();

    this.subscriptions.add(
      this.profileService.updateProfile(formData).subscribe({
        next: () => {
          this.savingProfile = false;
          this.profileSavedFlash = true;
          setTimeout(() => { this.profileSavedFlash = false; }, 2500);

          // Répercute le nom mis à jour dans la topbar.
          if (this.userProfile) {
            this.layoutService.setUserProfile({
              ...this.userProfile,
              first_name: formData.first_name,
              last_name: formData.last_name
            });
          }
        },
        error: (error) => {
          console.error('Erreur mise à jour profil:', error);
          this.savingProfile = false;
          const errorMsg = error.error?.detail || error.error?.first_name ||
                          error.error?.last_name || 'Erreur lors de la mise à jour';
          this.toastr.error(errorMsg, 'Erreur');
        }
      })
    );
  }
  
  /**
   * Ouvre le modal de changement de mot de passe
   */
  openPasswordModal(): void {
    this.showPasswordModal = true;
    this.passwordForm.reset();
  }
  
  /**
   * Ferme le modal de changement de mot de passe
   */
  closePasswordModal(): void {
    this.showPasswordModal = false;
    this.passwordForm.reset();
  }
  
  /**
   * Change le mot de passe
   */
  changePassword(): void {
    if (this.passwordForm.invalid) {
      this.toastr.warning('Veuillez corriger les erreurs du formulaire', 'Attention');
      this.passwordForm.markAllAsTouched();
      return;
    }
    
    this.isPasswordLoading = true;
    const passwordData = this.passwordForm.value;
    
    this.subscriptions.add(
      this.profileService.changePassword(passwordData).subscribe({
        next: (response) => {
          this.toastr.success(response.message, 'Succès');
          this.isPasswordLoading = false;
          this.closePasswordModal();
          
          // Déconnexion automatique si requis
          if (response.require_relogin) {
            setTimeout(() => {
              this.layoutService.logout();
              // Redirection vers login gérée par guard
            }, 2000);
          }
        },
        error: (error) => {
          console.error('Erreur changement mot de passe:', error);
          const errorMsg = error.error?.current_password || 
                          error.error?.new_password || 
                          error.error?.non_field_errors?.[0] || 
                          'Erreur lors du changement de mot de passe';
          this.toastr.error(errorMsg, 'Erreur');
          this.isPasswordLoading = false;
        }
      })
    );
  }
  
  /**
   * Basculer le thème
   */
  toggleTheme(): void {
    this.layoutService.toggleTheme();
    const currentTheme = this.layoutService.getCurrentTheme();
    this.toastr.info(
      `Thème ${currentTheme === 'dark' ? 'sombre' : 'clair'} activé`,
      'Préférences'
    );
  }
  
  /**
   * Obtenir les initiales pour l'avatar
   */
  getInitials(): string {
    if (!this.userProfile) return 'U';
    const first = this.userProfile.first_name?.charAt(0) || '';
    const last = this.userProfile.last_name?.charAt(0) || '';
    return (first + last).toUpperCase();
  }

  /**
   * Libellé « humain » (non technique) du rôle — identique au menu profil de la topbar,
   * pour une expérience cohérente. Le rôle brut (ROLE_*) n'est jamais montré.
   */
  roleLabel(role?: string | null): string {
    switch (role) {
      case 'ROLE_SUPER_ADMIN': return 'Super administrateur';
      case 'ROLE_ADMIN_SYSTEME': return 'Administrateur de la plateforme';
      case 'ROLE_ORGANISATION_ADMIN': return "Administrateur d'organisation";
      case 'ROLE_ORGANISATION_AGENT': return 'Opérateur';
      default: return 'Utilisateur';
    }
  }

  /** Icône FontAwesome associée au rôle (chip du profil), cohérente avec la topbar. */
  roleIcon(role?: string | null): string {
    switch (role) {
      case 'ROLE_SUPER_ADMIN': return 'fa-crown';
      case 'ROLE_ADMIN_SYSTEME': return 'fa-user-shield';
      case 'ROLE_ORGANISATION_ADMIN': return 'fa-user-tie';
      case 'ROLE_ORGANISATION_AGENT': return 'fa-user-gear';
      default: return 'fa-user';
    }
  }
  
  /**
   * Bascule la visibilité du mot de passe actuel
   */
  toggleCurrentPasswordVisibility(): void {
    this.showCurrentPassword = !this.showCurrentPassword;
  }
  
  /**
   * Bascule la visibilité du nouveau mot de passe
   */
  toggleNewPasswordVisibility(): void {
    this.showNewPassword = !this.showNewPassword;
  }
  
  /**
   * Bascule la visibilité de la confirmation du mot de passe
   */
  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }
  
  /**
   * Vérifie si tous les critères de mot de passe sont valides
   */
  areAllPasswordCriteriaValid(): boolean {
    return this.passwordCriteria.every(criterion => criterion.valid);
  }
  
  /**
   * Déclenche le sélecteur de fichier
   */
  triggerFileInput(): void {
    this.fileInput.nativeElement.click();
  }
  
  /**
   * Gère la sélection d'un fichier
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    
    if (!input.files || input.files.length === 0) {
      return;
    }
    
    const file = input.files[0];

    // Validation du format (extension) : JPG, JPEG, PNG, GIF, TIFF, WebP.
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!this.allowedPhotoExtensions.includes(ext)) {
      this.toastr.error(`Format non supporté. Formats acceptés : ${this.allowedPhotoLabel}`, 'Erreur');
      input.value = '';
      return;
    }

    // Validation taille (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB en bytes
    if (file.size > maxSize) {
      this.toastr.error('L\'image ne doit pas dépasser 5MB', 'Erreur');
      input.value = '';
      return;
    }
    
    // Upload la photo
    this.uploadProfilePicture(file);
    
    // Reset input pour permettre re-upload du même fichier
    input.value = '';
  }
  
  /**
   * Upload la photo de profil
   */
  uploadProfilePicture(file: File): void {
    this.isUploadingPhoto = true;
    this.savingProfile = true;  // Reflète l'action dans l'indicateur global de la page.

    this.subscriptions.add(
      this.profileService.uploadProfilePicture(file).subscribe({
        next: (profile) => {
          this.userProfile = profile;
          this.isUploadingPhoto = false;
          this.savingProfile = false;
          this.profileSavedFlash = true;
          setTimeout(() => { this.profileSavedFlash = false; }, 2500);

          // ← CORRECTION: Mettre à jour le LayoutService pour TopBar
          if (this.userProfile) {
            this.layoutService.setUserProfile({
              id: profile.id,
              email: profile.email,
              first_name: profile.first_name,
              last_name: profile.last_name,
              role: profile.role,
              organization_name: profile.organization_name,
              avatar: profile.profile_picture_url // ← Photo ou undefined pour fallback avatar
            });
          }
        },
        error: (error) => {
          console.error('Erreur upload photo:', error);
          this.isUploadingPhoto = false;
          this.savingProfile = false;
          if (estRefusQuota(error)) {
            this.toastr.error(messageRefusQuota(error), 'Quota de stockage de l\'organisation dépassé',
                              { timeOut: 15000, closeButton: true });
          } else {
            this.toastr.error(error?.error?.detail || 'Erreur lors de l\'upload de la photo', 'Erreur');
          }
        }
      })
    );
  }
  
  /** Ouvre la modale de confirmation de suppression de la photo de profil. */
  openDeletePhotoModal(): void {
    this.showDeletePhotoModal = true;
  }

  /** Ferme la modale de confirmation (sans supprimer). */
  closeDeletePhotoModal(): void {
    this.showDeletePhotoModal = false;
  }

  /**
   * Supprime la photo de profil (après confirmation dans la modale).
   */
  confirmDeletePhoto(): void {
    this.showDeletePhotoModal = false;
    this.savingProfile = true;  // Reflète l'action dans l'indicateur global de la page.

    this.subscriptions.add(
      this.profileService.deleteProfilePicture().subscribe({
        next: () => {
          this.savingProfile = false;
          this.profileSavedFlash = true;
          setTimeout(() => { this.profileSavedFlash = false; }, 2500);
          // Recharger le profil pour mettre à jour l'affichage page profil
          this.loadProfile();

          // ← CORRECTION: Mettre à jour LayoutService pour TopBar (photo = null)
          if (this.userProfile) {
            this.layoutService.setUserProfile({
              id: this.userProfile.id,
              email: this.userProfile.email,
              first_name: this.userProfile.first_name,
              last_name: this.userProfile.last_name,
              role: this.userProfile.role,
              organization_name: this.userProfile.organization_name,
              avatar: undefined // ← Supprimer photo, fallback sur avatar initiales
            });
          }
        },
        error: (error) => {
          console.error('Erreur suppression photo:', error);
          this.savingProfile = false;
          this.toastr.error('Erreur lors de la suppression de la photo', 'Erreur');
        }
      })
    );
  }
  
  /**
   * Gère l'erreur de chargement d'image
   */
  onImageError(event: any): void {
    console.warn('Erreur chargement image, fallback sur avatar');
    // Si l'image ne charge pas, on laisse Angular afficher l'avatar par défaut
    // grâce au *ngIf qui vérifie profile_picture_url
  }
}
