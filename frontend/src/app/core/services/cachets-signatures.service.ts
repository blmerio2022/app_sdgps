import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  ApercuTraitement, CachetRapportOptions, CachetSignature, ParametresTraitement,
} from '../models/cachet-signature.model';

/**
 * Cachets + signatures de l'opérateur (`/api/v1/cachets-signatures/`).
 *
 * Le traitement de l'image (fond retiré, encre gardée) est fait par le SERVEUR — un seul
 * algorithme, celui qui produit l'image apposée : l'aperçu interactif (`apercu`) passe
 * par lui aussi, sans rien enregistrer.
 */
@Injectable({ providedIn: 'root' })
export class CachetsSignaturesService {
  private url = `${environment.apiUrl}/v1/cachets-signatures/`;

  constructor(private http: HttpClient) {}

  list(): Observable<CachetSignature[]> {
    return this.http.get<any>(this.url).pipe(
      map(res => Array.isArray(res) ? res : (res?.results ?? [])),
    );
  }

  /** Traitement à blanc : renvoie le PNG détouré, n'enregistre rien. */
  apercu(image: Blob, parametres: ParametresTraitement): Observable<ApercuTraitement> {
    const form = new FormData();
    form.append('fichier', image, 'cachet.jpg');
    form.append('parametres', JSON.stringify(parametres));
    return this.http.post<ApercuTraitement>(`${this.url}apercu/`, form);
  }

  create(image: Blob, nom: string, parametres: ParametresTraitement,
         parDefaut = false): Observable<CachetSignature> {
    const form = new FormData();
    form.append('fichier', image, 'cachet.jpg');
    form.append('nom', nom);
    form.append('parametres', JSON.stringify(parametres));
    if (parDefaut) form.append('par_defaut', 'true');
    return this.http.post<CachetSignature>(this.url, form);
  }

  /** Renommer, changer le défaut ou reprendre le traitement (depuis l'original stocké). */
  update(id: string, changes: { nom?: string; par_defaut?: boolean;
                                parametres?: ParametresTraitement }): Observable<CachetSignature> {
    return this.http.patch<CachetSignature>(`${this.url}${id}/`, changes);
  }

  /** Remplacer l'image d'origine (nouvelle photo, ou image tournée) et retraiter. */
  replaceImage(id: string, image: Blob, parametres: ParametresTraitement,
               changes: { nom?: string; par_defaut?: boolean } = {}): Observable<CachetSignature> {
    const form = new FormData();
    form.append('fichier', image, 'cachet.jpg');
    form.append('parametres', JSON.stringify(parametres));
    if (changes.nom !== undefined) form.append('nom', changes.nom);
    if (changes.par_defaut !== undefined) form.append('par_defaut', String(changes.par_defaut));
    return this.http.patch<CachetSignature>(`${this.url}${id}/`, form);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}${id}/`);
  }

  /** Image d'origine (data URL), pour reprendre le traitement d'un cachet. */
  originale(id: string): Observable<string> {
    return this.http.get<{ image: string }>(`${this.url}${id}/originale/`).pipe(
      map(res => res.image),
    );
  }
}

/** Ajoute les options d'apposition aux paramètres d'une demande de rapport. */
export function withCachetParams(params: HttpParams,
                                 cachet?: CachetRapportOptions | null): HttpParams {
  if (!cachet?.cachetId) return params;
  return params.set('cachet', cachet.cachetId)
               .set('cachet_position', cachet.position)
               .set('cachet_taille', String(cachet.taille))
               .set('cachet_pages', cachet.pages);
}
