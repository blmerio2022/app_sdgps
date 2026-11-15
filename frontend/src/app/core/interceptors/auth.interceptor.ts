import { Injectable, Injector } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  private isRefreshing = false;
  private refreshDone$ = new BehaviorSubject<string | null>(null);

  /**
   * `AuthService` est résolu À LA DEMANDE, pas injecté au constructeur : il dépend de
   * `HttpClient`, qui dépend des intercepteurs — donc de celui-ci. Au démarrage avec un jeton
   * en mémoire, son constructeur lance une requête (contrôle du changement de mot de passe)
   * qui construisait cet intercepteur pendant que `AuthService` était encore en cours de
   * création : dépendance circulaire NG0200 dans la console.
   */
  constructor(private router: Router, private injector: Injector) {}

  private get authService(): AuthService { return this.injector.get(AuthService); }

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = localStorage.getItem('authToken');
    if (token) {
      request = this.addToken(request, token);
    }

    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && !request.url.includes('token/refresh')) {
          return this.handle401(request, next);
        }
        if (error.status === 403) {
          console.warn('⚠️ Accès refusé');
        }
        return throwError(() => error);
      })
    );
  }

  private addToken(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  private handle401(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!localStorage.getItem('refreshToken')) {
      this.forceLogout();
      return throwError(() => new Error('Session expirée'));
    }

    if (this.isRefreshing) {
      // Une autre requête est déjà en train de rafraîchir — attendre le résultat
      return this.refreshDone$.pipe(
        filter(token => token !== null),
        take(1),
        switchMap(token => next.handle(this.addToken(request, token!)))
      );
    }

    this.isRefreshing = true;
    this.refreshDone$.next(null);

    return this.authService.refreshToken().pipe(
      switchMap(newToken => {
        this.isRefreshing = false;
        this.refreshDone$.next(newToken);
        return next.handle(this.addToken(request, newToken));
      }),
      catchError(err => {
        this.isRefreshing = false;
        this.forceLogout();
        return throwError(() => err);
      })
    );
  }

  private forceLogout(): void {
    console.warn('⚠️ Session expirée - Déconnexion');
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
