import { Component, HostListener, Input } from '@angular/core';
import { libelleEnvironnement, VersionInfo, VersionService } from './version.service';

/**
 * Version déployée : « SDGPS v1.0.34 · staging ». Un clic ouvre « À propos » (commit,
 * dates, environnement, version de la page affichée).
 * `variante` : `login` (pied de la page de connexion) ou `sidebar` (bas du menu ; `compact`
 * quand le menu est réduit → numéro seul).
 */
@Component({
  selector: 'app-version-badge',
  templateUrl: './version-badge.component.html',
  styleUrls: ['./version-badge.component.scss'],
})
export class VersionBadgeComponent {
  @Input() variante: 'login' | 'sidebar' = 'login';
  @Input() compact = false;
  ouvert = false;

  constructor(public versions: VersionService) {}

  env(info: VersionInfo | null): string { return libelleEnvironnement(info?.environnement); }

  dateLisible(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  ouvrir(ev?: Event): void { ev?.stopPropagation(); this.ouvert = true; }
  fermer(): void { this.ouvert = false; }
  @HostListener('document:keydown.escape') onEscape(): void { this.fermer(); }
}
