import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import {
  GroupeRecherche, ICONES_RECHERCHE, RechercheService, ResultatRecherche,
} from '../../../services/recherche.service';

/** Délai d'anti-rebond de la frappe (ms). */
export const DELAI_RECHERCHE_MS = 250;

/**
 * Recherche globale : bouton dans la barre du haut + palette ouverte par Ctrl+K (⌘K).
 * Flèches haut/bas pour se déplacer, Entrée pour ouvrir, Échap pour fermer.
 */
@Component({
  selector: 'app-recherche-globale',
  templateUrl: './recherche-globale.component.html',
  styleUrls: ['./recherche-globale.component.scss'],
})
export class RechercheGlobaleComponent implements OnInit, OnDestroy {
  @ViewChild('champ') champ?: ElementRef<HTMLInputElement>;
  ouvert = false;
  q = '';
  groupes: GroupeRecherche[] = [];
  recents: ResultatRecherche[] = [];
  chargement = false;
  actif = 0;
  readonly mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  private frappe$ = new Subject<string>();
  private abonnement?: Subscription;

  constructor(private service: RechercheService, private router: Router) {}

  ngOnInit(): void {
    this.abonnement = this.frappe$.pipe(
      debounceTime(DELAI_RECHERCHE_MS),
      distinctUntilChanged(),
      switchMap(q => {
        if (q.trim().length < 2) { this.chargement = false; return of({ q, groupes: [], total: 0 }); }
        this.chargement = true;
        return this.service.rechercher(q).pipe(catchError(() => of({ q, groupes: [], total: 0 })));
      }),
    ).subscribe(r => { this.groupes = r.groupes; this.actif = 0; this.chargement = false; });
  }

  ngOnDestroy(): void { this.abonnement?.unsubscribe(); }

  @HostListener('document:keydown', ['$event'])
  raccourci(ev: KeyboardEvent): void {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.ouvert ? this.fermer() : this.ouvrir();
    } else if (this.ouvert && ev.key === 'Escape') {
      this.fermer();
    }
  }

  ouvrir(): void {
    this.ouvert = true;
    this.recents = this.service.recents();
    this.actif = 0;
    setTimeout(() => this.champ?.nativeElement.focus());
  }

  fermer(): void { this.ouvert = false; this.q = ''; this.groupes = []; this.frappe$.next(''); }

  onFrappe(): void { this.frappe$.next(this.q); }

  /** Liste plate affichée (résultats, ou récents quand la saisie est vide). */
  get elements(): ResultatRecherche[] {
    return this.q.trim().length >= 2 ? this.groupes.flatMap(g => g.resultats) : this.recents;
  }

  indexDe(r: ResultatRecherche): number { return this.elements.indexOf(r); }

  naviguer(ev: KeyboardEvent): void {
    const n = this.elements.length;
    if (!n) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); this.actif = (this.actif + 1) % n; }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.actif = (this.actif - 1 + n) % n; }
    else if (ev.key === 'Enter') { ev.preventDefault(); this.choisir(this.elements[this.actif]); }
  }

  choisir(r?: ResultatRecherche): void {
    if (!r) return;
    this.service.memoriser(r);
    const prefixe = this.router.url.startsWith('/admin/') ? '/admin/' : '/';
    this.router.navigateByUrl(prefixe + r.lien.replace(/^\/+/, ''));
    this.fermer();
  }

  oublierRecents(): void { this.service.oublier(); this.recents = []; }

  icone(type: string): string { return ICONES_RECHERCHE[type] || 'fa-magnifying-glass'; }

  get vide(): boolean { return this.q.trim().length >= 2 && !this.chargement && !this.groupes.length; }
}
