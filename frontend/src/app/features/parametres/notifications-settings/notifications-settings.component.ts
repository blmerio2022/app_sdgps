import { Component, OnInit } from '@angular/core';
import { NotificationsService, PreferencesNotifications, apparenceNotification } from '../../../core/services/notifications.service';

/**
 * Paramètres › Notifications : e-mails reçus en plus des notifications dans l'application.
 * La notification dans l'application est toujours créée ; seul l'e-mail est réglable.
 * Enregistrement immédiat à chaque bascule.
 */
@Component({
  selector: 'app-notifications-settings',
  templateUrl: './notifications-settings.component.html',
  styleUrls: ['./notifications-settings.component.scss'],
})
export class NotificationsSettingsComponent implements OnInit {
  prefs: PreferencesNotifications | null = null;
  chargement = true;
  enregistrement = false;
  enregistre = false;
  erreur = '';

  constructor(private service: NotificationsService) {}

  ngOnInit(): void {
    this.service.preferences().subscribe({
      next: p => { this.prefs = p; this.chargement = false; },
      error: () => { this.chargement = false; this.erreur = 'Chargement des préférences impossible.'; },
    });
  }

  basculerGlobal(actif: boolean): void { this.enregistrer({ emails_actifs: actif }); }

  basculerType(type: string, email: boolean): void { this.enregistrer({ types: { [type]: email } }); }

  private enregistrer(corps: { emails_actifs?: boolean; types?: Record<string, boolean> }): void {
    this.enregistrement = true; this.erreur = '';
    this.service.enregistrerPreferences(corps).subscribe({
      next: p => {
        this.prefs = p; this.enregistrement = false; this.enregistre = true;
        setTimeout(() => (this.enregistre = false), 2000);
      },
      error: e => { this.enregistrement = false; this.erreur = e?.error?.detail || 'Enregistrement impossible.'; },
    });
  }

  apparence(type: string) { return apparenceNotification(type); }
}
