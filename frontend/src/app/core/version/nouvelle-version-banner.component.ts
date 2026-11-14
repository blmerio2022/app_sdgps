import { Component } from '@angular/core';
import { VersionService } from './version.service';

/**
 * Bandeau « Une nouvelle version est disponible » : la version en ligne diffère de celle
 * de la page chargée (déploiement intervenu depuis). « Plus tard » le masque pour CETTE
 * version seulement : il revient si une autre version est encore déployée.
 */
@Component({
  selector: 'app-nouvelle-version',
  template: `
    <ng-container *ngIf="versions.nouvelleVersion$ | async as version">
      <div class="nv-banner" *ngIf="version !== ignoree" role="status" aria-live="polite">
        <span class="nv-icon"><i class="fas fa-arrows-rotate"></i></span>
        <span class="nv-text">
          <strong>Une nouvelle version est disponible</strong>
          <span>{{ version }} est en ligne — vous utilisez {{ versions.bundle.version }}.</span>
        </span>
        <button type="button" class="nv-later" (click)="ignoree = version">Plus tard</button>
        <button type="button" class="nv-reload" (click)="versions.recharger()">
          <i class="fas fa-rotate-right"></i> Recharger
        </button>
      </div>
    </ng-container>
  `,
  styles: [`
    .nv-banner {
      position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 3000;
      display: flex; align-items: center; gap: 12px; width: max-content; max-width: calc(100vw - 32px);
      padding: 10px 12px 10px 14px; border-radius: 14px;
      background: var(--secondary-color); color: var(--text-color);
      border: 1px solid var(--accent-color);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4); animation: nv-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    @keyframes nv-in { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .nv-icon { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0;
      color: var(--accent-color); background: rgba(204, 88, 88, 0.12); }
    .nv-text { display: flex; flex-direction: column; gap: 1px; font-size: 12px; color: var(--text-muted); min-width: 0; }
    .nv-text strong { font-size: 13px; color: var(--text-color); }
    .nv-later, .nv-reload { flex-shrink: 0; height: 32px; padding: 0 12px; border-radius: 9px; cursor: pointer; font-size: 12.5px; font-weight: 600; }
    .nv-later { background: transparent; border: 1px solid var(--border-color); color: var(--text-muted); }
    .nv-later:hover { color: var(--text-color); background: var(--hover-bg); }
    .nv-reload { display: inline-flex; align-items: center; gap: 7px; border: none; color: #fff; background: var(--accent-color); }
    .nv-reload:hover { filter: brightness(1.08); }
  `],
})
export class NouvelleVersionBannerComponent {
  ignoree: string | null = null;
  constructor(public versions: VersionService) {}
}
