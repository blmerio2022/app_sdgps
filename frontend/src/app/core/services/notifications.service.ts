import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface AppNotification {
  id: number;
  type: string;
  type_display: string;
  titre: string;
  message: string;
  lien: string;
  cible_type: string;
  cible_id: string;
  acteur_nom: string;
  lue: boolean;
  lue_le: string | null;
  created_at: string;
}

export interface PageNotifications {
  count: number;
  next: string | null;
  previous: string | null;
  results: AppNotification[];
  non_lues: number;
}

export interface PreferencesNotifications {
  emails_actifs: boolean;
  types: { type: string; libelle: string; email: boolean; defaut: boolean }[];
}

/**
 * Notifications personnelles (dossier soumis / validé / rejeté…, rapport prêt, sécurité).
 * `nonLues$` est partagé par la cloche et tout écran qui marque des notifications lues.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly url = `${environment.apiUrl}/v1/notifications/`;
  readonly nonLues$ = new BehaviorSubject<number>(0);

  constructor(private http: HttpClient) {}

  liste(page = 1, nonLuesSeules = false, taille = 20): Observable<PageNotifications> {
    let params = new HttpParams().set('page', page).set('page_size', taille);
    if (nonLuesSeules) params = params.set('non_lues', '1');
    return this.http.get<PageNotifications>(this.url, { params }).pipe(tap(p => this.nonLues$.next(p.non_lues)));
  }

  compte(): Observable<{ non_lues: number }> {
    return this.http.get<{ non_lues: number }>(`${this.url}compte/`).pipe(tap(r => this.nonLues$.next(r.non_lues)));
  }

  marquer(id: number, lue = true): Observable<AppNotification> {
    return this.http.post<AppNotification>(`${this.url}${id}/lue/`, { lue }).pipe(
      tap(() => this.nonLues$.next(Math.max(0, this.nonLues$.value + (lue ? -1 : 1)))));
  }

  toutLu(): Observable<{ marquees: number }> {
    return this.http.post<{ marquees: number }>(`${this.url}tout-lu/`, {}).pipe(tap(() => this.nonLues$.next(0)));
  }

  supprimer(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}${id}/`);
  }

  viderLues(): Observable<{ supprimees: number }> {
    return this.http.post<{ supprimees: number }>(`${this.url}vider/`, {});
  }

  preferences(): Observable<PreferencesNotifications> {
    return this.http.get<PreferencesNotifications>(`${this.url}preferences/`);
  }

  enregistrerPreferences(p: { emails_actifs?: boolean; types?: Record<string, boolean> }): Observable<PreferencesNotifications> {
    return this.http.put<PreferencesNotifications>(`${this.url}preferences/`, p);
  }
}

/** Icône + famille de couleur d'un type de notification. */
export function apparenceNotification(type: string): { icone: string; famille: string } {
  switch (type) {
    case 'DOSSIER_SOUMIS': return { icone: 'fa-inbox', famille: 'info' };
    case 'DOSSIER_VALIDE': return { icone: 'fa-circle-check', famille: 'succes' };
    case 'DOSSIER_REJETE': return { icone: 'fa-circle-xmark', famille: 'alerte' };
    case 'DOSSIER_CLOS': return { icone: 'fa-lock', famille: 'neutre' };
    case 'DOSSIER_ROUVERT': return { icone: 'fa-lock-open', famille: 'attention' };
    case 'RAPPORT_PRET': return { icone: 'fa-file-pdf', famille: 'succes' };
    case 'RAPPORT_ECHEC': return { icone: 'fa-triangle-exclamation', famille: 'alerte' };
    case 'SECURITE': return { icone: 'fa-shield-halved', famille: 'attention' };
    default: return { icone: 'fa-bell', famille: 'neutre' };
  }
}

/** « il y a 5 min », « hier », « 12/11/2026 ». */
export function ilYa(date: string, maintenant = new Date()): string {
  const d = new Date(date);
  const s = Math.max(0, Math.round((maintenant.getTime() - d.getTime()) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'hier';
  if (s < 7 * 86400) return `il y a ${Math.floor(s / 86400)} jours`;
  return d.toLocaleDateString('fr-FR');
}
