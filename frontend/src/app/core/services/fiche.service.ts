import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TypeFiche } from '../layout/interfaces/menu.interface';

/** Fiche d'un élément de la hiérarchie (cf. backend `projects/fiche.py`). */
export interface Fiche {
  type: TypeFiche;
  libelle_type: string;
  titre: string;
  sous_titre?: string | null;
  statut?: string | null;
  statut_display?: string | null;
  champs: { label: string; valeur: string }[];
  compteurs: { label: string; valeur: number }[];
  audit: { cree_par?: string | null; cree_le?: string | null; modifie_par?: string | null; modifie_le?: string | null };
}

/** Durée de vie d'une fiche en cache : survoler plusieurs fois le fil ne relance pas d'appel. */
const DUREE_CACHE_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class FicheService {
  private readonly url = `${environment.apiUrl}/v1/fiche`;
  private cache = new Map<string, { t: number; obs: Observable<Fiche> }>();

  constructor(private http: HttpClient) {}

  fiche(type: TypeFiche, id: string): Observable<Fiche> {
    const cle = `${type}:${id}`;
    const entree = this.cache.get(cle);
    if (entree && Date.now() - entree.t < DUREE_CACHE_MS) return entree.obs;
    const obs = this.http.get<Fiche>(`${this.url}/${type}/${id}/`).pipe(
      tap({ error: () => this.cache.delete(cle) }),   // une erreur n'est pas mise en cache
      shareReplay(1),
    );
    this.cache.set(cle, { t: Date.now(), obs });
    return obs;
  }

  /** Oublie les fiches en cache (après une modification, par ex.). */
  vider(): void { this.cache.clear(); }
}
