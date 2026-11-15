import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import {
  AppNotification, NotificationsService, apparenceNotification, ilYa,
} from '../../../services/notifications.service';

/** Intervalle de sondage du compteur (ms) — et à chaque retour sur l'onglet. */
export const SONDAGE_NOTIFICATIONS_MS = 60_000;

/**
 * Cloche de la barre du haut : compteur des notifications non lues + panneau déroulant.
 * Un clic sur une notification la marque lue et ouvre le dossier concerné.
 */
@Component({
  selector: 'app-notification-bell',
  templateUrl: './notification-bell.component.html',
  styleUrls: ['./notification-bell.component.scss'],
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  ouvert = false;
  chargement = false;
  nonLuesSeules = false;
  notifications: AppNotification[] = [];
  nonLues = 0;
  page = 1;
  plus = false;
  private abonnements: Subscription[] = [];

  constructor(private service: NotificationsService, private router: Router) {}

  ngOnInit(): void {
    this.abonnements.push(this.service.nonLues$.subscribe(n => (this.nonLues = n)));
    this.rafraichirCompte();
    this.abonnements.push(interval(SONDAGE_NOTIFICATIONS_MS).subscribe(() => this.rafraichirCompte()));
  }

  ngOnDestroy(): void { this.abonnements.forEach(a => a.unsubscribe()); }

  @HostListener('document:visibilitychange')
  onVisibilite(): void { if (document.visibilityState === 'visible') this.rafraichirCompte(); }

  rafraichirCompte(): void {
    if (!localStorage.getItem('authToken')) return;
    this.service.compte().subscribe({ error: () => {} });
  }

  basculer(): void {
    this.ouvert = !this.ouvert;
    if (this.ouvert) this.charger(1);
  }

  fermer(): void { this.ouvert = false; }

  charger(page: number): void {
    this.chargement = true;
    this.service.liste(page, this.nonLuesSeules).subscribe({
      next: p => {
        this.notifications = page === 1 ? p.results : [...this.notifications, ...p.results];
        this.page = page;
        this.plus = !!p.next;
        this.chargement = false;
      },
      error: () => (this.chargement = false),
    });
  }

  filtrer(nonLues: boolean): void { this.nonLuesSeules = nonLues; this.charger(1); }

  ouvrir(n: AppNotification): void {
    if (!n.lue) this.basculerLue(n);
    if (n.lien) {
      const prefixe = this.router.url.startsWith('/admin/') ? '/admin/' : '/';
      this.router.navigateByUrl(prefixe + n.lien.replace(/^\/+/, ''));
      this.fermer();
    }
  }

  basculerLue(n: AppNotification, ev?: Event): void {
    ev?.stopPropagation();
    this.service.marquer(n.id, !n.lue).subscribe(maj => {
      n.lue = maj.lue;
      if (this.nonLuesSeules && n.lue) this.notifications = this.notifications.filter(x => x.id !== n.id);
    });
  }

  supprimer(n: AppNotification, ev: Event): void {
    ev.stopPropagation();
    this.service.supprimer(n.id).subscribe(() => {
      this.notifications = this.notifications.filter(x => x.id !== n.id);
      if (!n.lue) this.service.nonLues$.next(Math.max(0, this.nonLues - 1));
    });
  }

  toutLu(): void {
    this.service.toutLu().subscribe(() => {
      this.notifications.forEach(n => (n.lue = true));
      if (this.nonLuesSeules) this.notifications = [];
    });
  }

  viderLues(): void {
    this.service.viderLues().subscribe(() => (this.notifications = this.notifications.filter(n => !n.lue)));
  }

  apparence(type: string) { return apparenceNotification(type); }
  quand(date: string): string { return ilYa(date); }
  get badge(): string { return this.nonLues > 99 ? '99+' : String(this.nonLues); }
}
