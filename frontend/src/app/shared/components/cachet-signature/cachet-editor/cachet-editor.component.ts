import {
  Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output,
} from '@angular/core';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';
import {
  ApercuTraitement, CadreCachet, CachetSignature, CouleurEncre, PARAMETRES_DEFAUT,
  ParametresTraitement,
} from '../../../../core/models/cachet-signature.model';
import { CachetsSignaturesService } from '../../../../core/services/cachets-signatures.service';
import { ImagePreparee, lireFichier, preparerImage } from '../cachet.util';

type Poignee = 'deplacer' | 'no' | 'ne' | 'so' | 'se';

/** Taille maximale du fichier déposé (le serveur refuse au-delà de 15 Mo). */
export const TAILLE_MAX_FICHIER = 15 * 1024 * 1024;
const CADRE_PLEIN: CadreCachet = { x: 0, y: 0, l: 1, h: 1 };
const CADRE_MIN = 0.04;

/**
 * Éditeur de cachet + signature (modale).
 *
 * L'opérateur dépose (ou colle) la photo de son cachet signé ; il recadre, tourne, règle
 * la sensibilité et l'encre, et voit EN DIRECT le résultat détouré que le serveur
 * produira — c'est le même traitement, appelé à blanc (`apercu`). Le résultat se juge sur
 * damier (transparence) ou sur une page de document.
 *
 * La rotation est appliquée par le navigateur à l'image envoyée (`preparerImage`) : le
 * serveur reçoit donc toujours `rotation: 0`, et le cadre se lit sur l'image telle
 * qu'elle est affichée.
 */
@Component({
  selector: 'app-cachet-editor',
  templateUrl: './cachet-editor.component.html',
  styleUrls: ['./cachet-editor.component.scss'],
})
export class CachetEditorComponent implements OnInit, OnDestroy {
  /** Cachet à reprendre ; absent = création. */
  @Input() cachet: CachetSignature | null = null;
  @Output() saved = new EventEmitter<CachetSignature>();
  @Output() closed = new EventEmitter<void>();

  source: string | null = null;           // data URL de l'image d'origine (non tournée)
  prepared: ImagePreparee | null = null;  // image envoyée (tournée, ≤ 2000 px)
  rotation: 0 | 90 | 180 | 270 = 0;
  imageModifiee = false;                  // nouvelle image ou rotation → à téléverser

  sensibilite = PARAMETRES_DEFAUT.sensibilite;
  couleur: CouleurEncre = PARAMETRES_DEFAUT.couleur;
  lissage = PARAMETRES_DEFAUT.lissage;
  cadre: CadreCachet = { ...CADRE_PLEIN };

  apercu: ApercuTraitement | null = null;
  apercuEnCours = false;
  apercuErreur = '';
  fond: 'damier' | 'document' = 'damier';

  nom = '';
  parDefaut = false;
  chargement = false;
  enregistrement = false;
  erreur = '';
  survolDepot = false;

  readonly couleurs: { valeur: CouleurEncre; libelle: string; pastille: string }[] = [
    { valeur: 'origine', libelle: "D'origine", pastille: 'linear-gradient(135deg,#1a2f8a 0 50%,#16161a 50%)' },
    { valeur: 'bleu', libelle: 'Bleue', pastille: '#183494' },
    { valeur: 'noir', libelle: 'Noire', pastille: '#16161a' },
  ];

  private apercu$ = new Subject<void>();
  private sub?: Subscription;
  private glisse: { mode: Poignee; x0: number; y0: number; cadre0: CadreCachet; rect: DOMRect } | null = null;

  constructor(private service: CachetsSignaturesService) {}

  get edition(): boolean { return !!this.cachet; }
  get peutEnregistrer(): boolean {
    return !!this.prepared && !!this.nom.trim() && !!this.apercu && !this.apercuErreur
      && !this.enregistrement && !this.apercuEnCours;
  }
  get cadreRecadre(): boolean {
    const c = this.cadre;
    return c.x > 0.001 || c.y > 0.001 || c.l < 0.999 || c.h < 0.999;
  }
  get parametres(): ParametresTraitement {
    return {
      sensibilite: this.sensibilite, couleur: this.couleur, lissage: this.lissage,
      rotation: 0, cadre: this.cadreRecadre ? { ...this.cadre } : null,
    };
  }
  get libelleSensibilite(): string {
    if (this.sensibilite < 25) return 'Encre franche seulement';
    if (this.sensibilite < 45) return 'Sélective';
    if (this.sensibilite <= 60) return 'Équilibrée';
    if (this.sensibilite <= 80) return 'Traits fins conservés';
    return 'Traits pâles conservés';
  }

  ngOnInit(): void {
    this.sub = this.apercu$.pipe(
      debounceTime(320),
      switchMap(() => {
        if (!this.prepared) return of(null);
        this.apercuEnCours = true;
        return this.service.apercu(this.prepared.blob, this.parametres).pipe(
          catchError(err => {
            this.apercuErreur = err?.error?.detail || "Le traitement de l'image a échoué.";
            return of(null);
          }),
        );
      }),
    ).subscribe(res => {
      this.apercuEnCours = false;
      if (res) { this.apercu = res; this.apercuErreur = ''; }
    });

    if (this.cachet) {
      this.nom = this.cachet.nom;
      this.parDefaut = this.cachet.par_defaut;
      const p = { ...PARAMETRES_DEFAUT, ...(this.cachet.parametres || {}) };
      this.sensibilite = p.sensibilite;
      this.couleur = p.couleur;
      this.lissage = p.lissage;
      this.cadre = p.cadre ? { ...p.cadre } : { ...CADRE_PLEIN };
      this.chargement = true;
      this.service.originale(this.cachet.id).subscribe({
        next: src => this.chargerSource(src, false),
        error: err => {
          this.chargement = false;
          this.erreur = err?.error?.detail || "L'image d'origine de ce cachet est introuvable.";
        },
      });
    }
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  // ------------------------------------------------------------------ dépôt de l'image
  onFichier(event: Event): void {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.accepter(f);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.survolDepot = false;
    const f = event.dataTransfer?.files?.[0];
    if (f) this.accepter(f);
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.survolDepot = true; }

  /** Coller une image (capture d'écran, copie depuis un scan) : Ctrl+V. */
  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const cible = event.target as HTMLElement | null;
    if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA')) return;
    const item = Array.from(event.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) { event.preventDefault(); this.accepter(f); }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (!this.enregistrement) this.closed.emit(); }

  accepter(f: File): void {
    this.erreur = '';
    if (!f.type.startsWith('image/')) {
      this.erreur = 'Déposez une image : photo ou scan (JPEG, PNG, WebP…).';
      return;
    }
    if (f.size > TAILLE_MAX_FICHIER) {
      this.erreur = 'Image trop volumineuse (15 Mo au maximum).';
      return;
    }
    this.chargement = true;
    lireFichier(f)
      .then(src => {
        if (!this.nom.trim()) this.nom = this.nomParDefaut(f.name);
        this.chargerSource(src, true);
      })
      .catch(() => { this.chargement = false; this.erreur = 'Image illisible.'; });
  }

  remplacer(): void {
    this.source = null;
    this.prepared = null;
    this.apercu = null;
    this.apercuErreur = '';
    this.rotation = 0;
    this.cadre = { ...CADRE_PLEIN };
  }

  private nomParDefaut(nomFichier: string): string {
    const base = (nomFichier || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return (base && !/^(image|img|scan|photo|dsc)\s*\d*$/i.test(base)) ? base.slice(0, 120)
      : 'Cachet et signature';
  }

  private chargerSource(src: string, nouvelle: boolean): void {
    this.source = src;
    this.rotation = 0;
    if (nouvelle) {
      this.imageModifiee = true;
      this.cadre = { ...CADRE_PLEIN };
    }
    this.preparer();
  }

  private preparer(): void {
    if (!this.source) return;
    this.chargement = true;
    preparerImage(this.source, this.rotation)
      .then(p => {
        this.prepared = p;
        this.chargement = false;
        this.demanderApercu();
      })
      .catch(() => { this.chargement = false; this.erreur = 'Image illisible.'; });
  }

  // ------------------------------------------------------------------ réglages
  tourner(sens: 1 | -1): void {
    this.rotation = (((this.rotation + sens * 90) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    this.imageModifiee = true;
    this.cadre = { ...CADRE_PLEIN };
    this.preparer();
  }

  choisirCouleur(c: CouleurEncre): void {
    if (this.couleur === c) return;
    this.couleur = c;
    this.demanderApercu();
  }

  reinitialiserCadre(): void { this.cadre = { ...CADRE_PLEIN }; this.demanderApercu(); }

  demanderApercu(): void {
    if (!this.prepared) return;
    this.apercuErreur = '';
    this.apercuEnCours = true;
    this.apercu$.next();
  }

  // ------------------------------------------------------------------ recadrage
  debutGlisse(event: PointerEvent, mode: Poignee, scene: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.glisse = { mode, x0: event.clientX, y0: event.clientY, cadre0: { ...this.cadre },
                    rect: scene.getBoundingClientRect() };
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.glisse) return;
    const g = this.glisse;
    this.cadre = calculerCadre(g.mode, g.cadre0,
      (event.clientX - g.x0) / g.rect.width, (event.clientY - g.y0) / g.rect.height);
  }

  @HostListener('document:pointerup')
  onPointerUp(): void {
    if (!this.glisse) return;
    this.glisse = null;
    this.demanderApercu();
  }

  // ------------------------------------------------------------------ enregistrement
  enregistrer(): void {
    if (!this.peutEnregistrer || !this.prepared) return;
    this.enregistrement = true;
    this.erreur = '';
    const nom = this.nom.trim();
    const requete = !this.cachet
      ? this.service.create(this.prepared.blob, nom, this.parametres, this.parDefaut)
      : this.imageModifiee
        ? this.service.replaceImage(this.cachet.id, this.prepared.blob, this.parametres,
                                    { nom, par_defaut: this.parDefaut })
        : this.service.update(this.cachet.id, { nom, par_defaut: this.parDefaut,
                                                parametres: this.parametres });
    requete.subscribe({
      next: c => { this.enregistrement = false; this.saved.emit(c); },
      error: err => {
        this.enregistrement = false;
        this.erreur = err?.error?.detail || "L'enregistrement du cachet a échoué.";
      },
    });
  }

  fermer(): void { if (!this.enregistrement) this.closed.emit(); }
}

/**
 * Nouveau cadre après un glissement de (dx, dy) — fractions de l'image — selon la poignée.
 * Le cadre reste dans l'image et ne descend jamais sous `CADRE_MIN`.
 */
export function calculerCadre(mode: Poignee, c: CadreCachet, dx: number, dy: number): CadreCachet {
  const borne = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  if (mode === 'deplacer') {
    return { ...c, x: borne(c.x + dx, 0, 1 - c.l), y: borne(c.y + dy, 0, 1 - c.h) };
  }
  let gauche = c.x, haut = c.y, droite = c.x + c.l, bas = c.y + c.h;
  if (mode === 'no' || mode === 'so') gauche = borne(gauche + dx, 0, droite - CADRE_MIN);
  if (mode === 'ne' || mode === 'se') droite = borne(droite + dx, gauche + CADRE_MIN, 1);
  if (mode === 'no' || mode === 'ne') haut = borne(haut + dy, 0, bas - CADRE_MIN);
  if (mode === 'so' || mode === 'se') bas = borne(bas + dy, haut + CADRE_MIN, 1);
  return { x: gauche, y: haut, l: droite - gauche, h: bas - haut };
}
