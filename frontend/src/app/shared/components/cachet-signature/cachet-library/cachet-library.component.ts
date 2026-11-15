import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CachetSignature } from '../../../../core/models/cachet-signature.model';
import { CachetsSignaturesService } from '../../../../core/services/cachets-signatures.service';

/**
 * Bibliothèque des cachets + signatures de l'opérateur.
 *
 * - `mode="choisir"` (modale Rapport PDF) : cartes compactes, sélectionnables ;
 * - `mode="gerer"`   (Paramètres) : cartes larges, avec date de dernière utilisation.
 * Dans les deux cas : créer, reprendre, définir par défaut, supprimer (confirmation sur
 * place). La liste est émise à chaque changement (`cachetsChange`) pour que le parent
 * connaisse les proportions du cachet choisi.
 */
@Component({
  selector: 'app-cachet-library',
  templateUrl: './cachet-library.component.html',
  styleUrls: ['./cachet-library.component.scss'],
})
export class CachetLibraryComponent implements OnInit {
  @Input() mode: 'choisir' | 'gerer' = 'gerer';
  @Input() selectedId: string | null = null;
  @Output() selectedIdChange = new EventEmitter<string | null>();
  @Output() cachetsChange = new EventEmitter<CachetSignature[]>();

  cachets: CachetSignature[] = [];
  chargement = true;
  erreur = '';
  editeurOuvert = false;
  enEdition: CachetSignature | null = null;
  aSupprimer: string | null = null;
  occupe: string | null = null;

  constructor(private service: CachetsSignaturesService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true;
    this.service.list().subscribe({
      next: liste => { this.chargement = false; this.erreur = ''; this.publier(liste); },
      error: () => { this.chargement = false; this.erreur = 'Impossible de charger vos cachets.'; },
    });
  }

  choisir(c: CachetSignature): void {
    if (this.mode !== 'choisir' || this.aSupprimer) return;
    this.selectedId = c.id;
    this.selectedIdChange.emit(c.id);
  }

  nouveau(): void { this.enEdition = null; this.editeurOuvert = true; }
  modifier(c: CachetSignature, event?: Event): void {
    event?.stopPropagation();
    this.enEdition = c;
    this.editeurOuvert = true;
  }

  onEnregistre(c: CachetSignature): void {
    this.editeurOuvert = false;
    this.enEdition = null;
    let liste = this.cachets.some(x => x.id === c.id)
      ? this.cachets.map(x => (x.id === c.id ? c : x))
      : [c, ...this.cachets];
    if (c.par_defaut) liste = liste.map(x => (x.id === c.id ? x : { ...x, par_defaut: false }));
    this.publier(liste);
    // Un cachet tout juste créé ou repris est, de toute évidence, celui que l'on veut.
    if (this.mode === 'choisir') { this.selectedId = c.id; this.selectedIdChange.emit(c.id); }
  }

  definirDefaut(c: CachetSignature, event: Event): void {
    event.stopPropagation();
    if (c.par_defaut || this.occupe) return;
    this.occupe = c.id;
    this.service.update(c.id, { par_defaut: true }).subscribe({
      next: () => {
        this.occupe = null;
        this.publier(this.cachets.map(x => ({ ...x, par_defaut: x.id === c.id })));
      },
      error: () => { this.occupe = null; this.erreur = "Le cachet par défaut n'a pas pu être changé."; },
    });
  }

  demanderSuppression(c: CachetSignature, event: Event): void {
    event.stopPropagation();
    this.aSupprimer = c.id;
  }

  annulerSuppression(event: Event): void { event.stopPropagation(); this.aSupprimer = null; }

  confirmerSuppression(c: CachetSignature, event: Event): void {
    event.stopPropagation();
    this.occupe = c.id;
    this.service.delete(c.id).subscribe({
      next: () => {
        this.occupe = null;
        this.aSupprimer = null;
        let liste = this.cachets.filter(x => x.id !== c.id);
        // Le serveur passe le défaut au plus récent : on reflète la même règle.
        if (c.par_defaut && liste.length && !liste.some(x => x.par_defaut)) {
          const suivant = [...liste].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          liste = liste.map(x => ({ ...x, par_defaut: x.id === suivant.id }));
        }
        this.publier(liste);
        if (this.selectedId === c.id) {
          const repli = liste.find(x => x.par_defaut) ?? liste[0] ?? null;
          this.selectedId = repli?.id ?? null;
          this.selectedIdChange.emit(this.selectedId);
        }
      },
      error: () => { this.occupe = null; this.erreur = "La suppression du cachet a échoué."; },
    });
  }

  trackById(_: number, c: CachetSignature): string { return c.id; }

  private publier(liste: CachetSignature[]): void {
    this.cachets = [...liste].sort((a, b) =>
      Number(b.par_defaut) - Number(a.par_defaut) || b.updated_at.localeCompare(a.updated_at));
    this.cachetsChange.emit(this.cachets);
  }
}
