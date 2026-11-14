import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, of, Subscription, timer } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { BUILD_VERSION } from './build-version';

/** Réponse de `GET /api/version/` (publique). */
export interface VersionInfo {
  version: string;
  commit: string;
  date_commit: string;
  date_build: string;
  environnement: string;
}

/** Sondage de la version en ligne : assez fréquent pour qu'un testeur voie vite le bandeau. */
export const INTERVALLE_SONDAGE_MS = 5 * 60 * 1000;
const NON_COMPARABLES = new Set(['', 'dev', 'inconnue']);

/**
 * Version de l'application.
 *
 * - `info$` : version de l'instance DÉPLOYÉE (API), affichée partout ;
 * - `nouvelleVersion$` : version en ligne différente de celle de CE bundle (compilée dans
 *   `build-version.ts`) → l'utilisateur tourne sur une page d'avant le déploiement.
 *   Jamais en développement (bundle `dev`) ni si l'une des deux versions est inconnue.
 */
@Injectable({ providedIn: 'root' })
export class VersionService implements OnDestroy {
  readonly bundle = BUILD_VERSION;
  private readonly infoSubject = new BehaviorSubject<VersionInfo | null>(null);
  readonly info$ = this.infoSubject.asObservable();
  readonly nouvelleVersion$: Observable<string | null> = this.info$.pipe(
    map(info => estNouvelle(this.bundle.version, info?.version) ? info!.version : null),
  );
  private sondage?: Subscription;

  constructor(private http: HttpClient, private zone: NgZone) {}

  /** Lance le chargement puis le sondage périodique (idempotent). */
  demarrer(): void {
    if (this.sondage) return;
    // Hors zone : un timer permanent empêcherait Angular (et les tests e2e) d'être « stable ».
    this.zone.runOutsideAngular(() => {
      this.sondage = timer(0, INTERVALLE_SONDAGE_MS).subscribe(() => this.zone.run(() => this.rafraichir()));
    });
    document.addEventListener('visibilitychange', this.surVisibilite);
  }

  rafraichir(): void {
    this.http.get<VersionInfo>(`${environment.apiUrl}/version/`).pipe(
      catchError(() => of(null)),   // une API momentanément injoignable ne casse rien
    ).subscribe(info => { if (info) this.infoSubject.next(info); });
  }

  /** Retour sur l'onglet : vérifier tout de suite plutôt qu'attendre le prochain tour. */
  private surVisibilite = (): void => {
    if (document.visibilityState === 'visible') this.rafraichir();
  };

  recharger(): void { window.location.reload(); }

  ngOnDestroy(): void {
    this.sondage?.unsubscribe();
    document.removeEventListener('visibilitychange', this.surVisibilite);
  }
}

export function estNouvelle(bundle: string, enLigne: string | undefined | null): boolean {
  if (!enLigne || NON_COMPARABLES.has(bundle) || NON_COMPARABLES.has(enLigne)) return false;
  return bundle !== enLigne;
}

/** `development` → « dev » ; la production n'est pas affichée (c'est le cas normal). */
export function libelleEnvironnement(env: string | undefined): string {
  const libelles: Record<string, string> = { development: 'dev', staging: 'staging', preprod: 'préprod' };
  return env && env !== 'production' ? (libelles[env] ?? env) : '';
}
