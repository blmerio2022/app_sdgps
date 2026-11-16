import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, concatMap, map, switchMap, toArray } from 'rxjs/operators';
import {
  CandidatImport, FichierDepose, ImagePlan, ImportMasseService, LignePlan, PlanImport, lireEntree, utile,
} from '../../../core/services/import-masse.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { PdfRenderService, canvasToJpeg } from '../../../core/services/pdf-render.service';

export interface SessionChoix { id: string; numero_session: number; }

type Etape = 'depot' | 'plan' | 'import' | 'fin';
interface Resultat { fichier: string; ok: boolean; detail: string; }

export const LIBELLES_IMAGES: Record<string, string> = {
  PPA: 'Photos des points anciens', PPN: 'Photos des points nouveaux',
  CCSPA: 'Canevas de contrôle de stabilité', CDC: 'Canevas de densification', CLC: 'Canevas de levé',
  RDC: 'Rapport de consultation',
};

/**
 * Import en masse d'un dossier (modale) : déposer les fichiers — ou le DOSSIER entier, pour
 * que les rapports HTML de TBC soient lus depuis leur dossier `_files` —, vérifier le plan
 * proposé (pièces, images rattachées aux points, rapport de contrôle), puis importer.
 * Chaque étape passe par les imports unitaires : mêmes contrôles côté serveur.
 */
@Component({
  selector: 'app-import-masse',
  templateUrl: './import-masse.component.html',
  styleUrls: ['./import-masse.component.scss'],
})
export class ImportMasseComponent {
  @Input() ssdgpsId!: string;
  /** Sessions du SDGPS (multi-session : une pièce de niveau session doit en choisir une). */
  @Input() sessions: SessionChoix[] = [];
  @Input() multiSession = false;
  @Output() fermee = new EventEmitter<void>();
  @Output() termine = new EventEmitter<number>();

  etape: Etape = 'depot';
  depots: FichierDepose[] = [];
  ignoresAuDepot = 0;
  reponse: PlanImport | null = null;
  plan: LignePlan[] = [];
  images: ImagePlan[] = [];
  sessionParLigne: Record<number, string | null> = {};
  genererRc = false;
  analyse = false;
  /** Message pendant la préparation (conversion des PDF). */
  preparation = '';
  pagesPdf = 0;
  pdfIllisibles: string[] = [];
  erreur = '';
  survol = false;
  progression = 0;
  resultats: Resultat[] = [];
  readonly libellesImages = LIBELLES_IMAGES;
  readonly typesImages = Object.keys(LIBELLES_IMAGES);

  constructor(private service: ImportMasseService, private pieces: PiecesService,
              private pdf: PdfRenderService) {}

  // ---- étape 1 : dépôt (fichiers ou dossier) ----
  ajouterDepots(liste: FichierDepose[]): void {
    const deja = new Set(this.depots.map(d => d.chemin + d.fichier.size));
    for (const d of liste) {
      if (!utile(d.chemin)) { this.ignoresAuDepot++; continue; }
      if (deja.has(d.chemin + d.fichier.size)) continue;
      deja.add(d.chemin + d.fichier.size);
      this.depots.push(d);
    }
  }

  ajouter(liste: FileList | File[] | null): void {
    if (!liste) return;
    this.ajouterDepots(Array.from(liste).map(f => ({ fichier: f, chemin: (f as any).webkitRelativePath || f.name })));
  }

  async onDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    this.survol = false;
    const items = Array.from(ev.dataTransfer?.items || []);
    const entrees = items.map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    if (entrees.length) {
      const lus = await Promise.all(entrees.map(e => lireEntree(e)));
      this.ajouterDepots(lus.flat());
    } else {
      this.ajouter(ev.dataTransfer?.files || null);
    }
  }
  onDragOver(ev: DragEvent): void { ev.preventDefault(); this.survol = true; }
  retirer(i: number): void { this.depots.splice(i, 1); }
  vider(): void { this.depots = []; this.ignoresAuDepot = 0; }

  get resumeDepot(): { tableaux: number; html: number; images: number; pdf: number } {
    const c = (re: RegExp) => this.depots.filter(d => re.test(d.chemin)).length;
    return { tableaux: c(/\.(csv|xlsx)$/i), html: c(/\.html?$/i), images: c(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic)$/i),
             pdf: c(/\.pdf$/i) };
  }

  /** PDF déposés : chaque page est rendue en image dans le navigateur (le serveur ne rend
   * pas les PDF), puis classée comme les autres images (canevas, consultation, photos). */
  async convertirPdf(): Promise<void> {
    const pdfs = this.depots.filter(d => /\.pdf$/i.test(d.chemin));
    if (!pdfs.length) return;
    this.preparation = `Conversion de ${pdfs.length} PDF en images…`;
    const pages: FichierDepose[] = [];
    for (const d of pdfs) {
      try {
        const doc = await this.pdf.open(d.fichier);
        const base = d.fichier.name.replace(/\.pdf$/i, '');
        const dossier = d.chemin.includes('/') ? d.chemin.slice(0, d.chemin.lastIndexOf('/') + 1) : '';
        for (let n = 1; n <= doc.numPages; n++) {
          const canvas = await doc.renderPage(n, 1600);
          const nom = doc.numPages > 1 ? `${base}-p${n}.jpg` : `${base}.jpg`;
          pages.push({ fichier: await canvasToJpeg(canvas, nom, 2 * 1024 * 1024), chemin: dossier + nom });
        }
        doc.destroy();
        this.pagesPdf += doc.numPages;
      } catch {
        this.pdfIllisibles.push(d.chemin);
      }
    }
    this.depots = this.depots.filter(d => !/\.pdf$/i.test(d.chemin)).concat(pages);
    this.preparation = '';
  }

  analyser(): void {
    if (!this.depots.length) return;
    this.analyse = true; this.erreur = '';
    if (this.depots.some(d => /\.pdf$/i.test(d.chemin))) {
      this.convertirPdf().then(() => this.lancerAnalyse());
    } else {
      this.lancerAnalyse();
    }
  }

  private lancerAnalyse(): void {
    this.service.plan(this.ssdgpsId, this.depots).subscribe({
      next: p => {
        this.reponse = p;
        this.plan = p.plan;
        this.images = p.images;
        this.genererRc = p.rc_possible;
        this.sessionParLigne = {};
        this.plan.forEach((_, i) => (this.sessionParLigne[i] = null));
        this.analyse = false; this.etape = 'plan';
      },
      error: e => { this.analyse = false; this.erreur = e?.error?.detail || 'Analyse des fichiers impossible.'; },
    });
  }

  // ---- étape 2 : plan ----
  /** Pages-cadres TBC déposées sans leur dossier `_files` : leurs données manquent. */
  get cadresSansDonnees(): LignePlan[] { return this.plan.filter(l => l.cadre); }

  /** Ajout du (des) dossier(s) `_files` manquant(s), puis nouvelle analyse. */
  ajouterDossiersManquants(liste: FileList | null): void {
    this.ajouter(liste);
    this.analyser();
  }

  candidat(l: LignePlan): CandidatImport | undefined { return l.candidats.find(c => c.type_piece === l.type_piece); }

  changerType(l: LignePlan, type: string | null): void {
    l.type_piece = type;
    const c = this.candidat(l);
    l.mapping = c ? { ...c.mapping } : {};
    l.numero = c?.repetable ? (l.numero || c.numero_nom || 1) : null;
    l.piece_existante = null;   // l'existant n'est connu que pour le type proposé
    l.action = type ? 'creer' : 'ignorer';
  }

  sessionRequise(l: LignePlan): boolean {
    return this.multiSession && this.candidat(l)?.niveau === 'session' && l.action === 'creer';
  }

  /** Pourquoi la ligne ne peut pas être importée telle quelle (vide = prête). */
  blocage(l: LignePlan, i: number): string {
    if (l.action === 'ignorer') return '';
    if (!l.type_piece) return 'Choisissez un type';
    if (l.mode === 'tableau' && !Object.keys(l.mapping || {}).length) return 'Aucune colonne reconnue';
    if (this.candidat(l)?.repetable && !l.numero) return 'Numéro requis';
    if (this.sessionRequise(l) && !this.sessionParLigne[i]) return 'Session requise';
    return '';
  }

  pointsDe(type: string | null): string[] {
    return (type === 'PPA' || type === 'PPN') ? (this.reponse?.points[type] || []) : [];
  }

  changerTypeImage(img: ImagePlan, type: string | null): void {
    img.type_piece = type;
    if (!this.pointsDe(type).includes(img.point)) img.point = '';
  }

  get imagesRetenues(): ImagePlan[] { return this.images.filter(i => !!i.type_piece); }
  get imagesSansPoint(): number {
    return this.imagesRetenues.filter(i => (i.type_piece === 'PPA' || i.type_piece === 'PPN') && !i.point).length;
  }
  get aImporter(): number { return this.plan.filter(l => l.action !== 'ignorer').length; }
  get pret(): boolean {
    return (this.aImporter > 0 || this.imagesRetenues.length > 0 || this.genererRc)
      && this.plan.every((l, i) => !this.blocage(l, i));
  }
  pourcent(c?: CandidatImport | null): number { return Math.round(Math.min(1, c?.score || 0) * 100); }
  icone(l: LignePlan): string { return l.mode === 'html' ? 'fa-file-code' : (l.feuille ? 'fa-file-excel' : 'fa-file-csv'); }

  // ---- étape 3 : import (pièces, puis images, puis rapport de contrôle) ----
  importer(): void {
    if (!this.pret || !this.reponse) return;
    this.etape = 'import'; this.progression = 0; this.resultats = [];
    const creees: Record<string, string> = {};                 // type → pièce (pour y rattacher les images)
    const travaux = this.plan.map((l, i) => ({ l, i, f: this.depots[l.index]?.fichier }))
      .filter(t => t.l.action !== 'ignorer' && t.f);
    const groupes = this.groupesImages();
    const total = travaux.length + groupes.length + (this.genererRc ? 1 : 0);
    const avancer = (r: Resultat) => {
      this.resultats.push(r);
      this.progression = Math.round(100 * this.resultats.length / Math.max(1, total));
    };

    const etapePieces$ = from(travaux).pipe(concatMap(t => {
      const appel = t.l.mode === 'html'
        ? this.service.importerHtml(this.ssdgpsId, t.f!, t.l, this.sessionParLigne[t.i])
        : this.service.importer(this.ssdgpsId, t.f!, t.l, this.sessionParLigne[t.i]);
      return appel.pipe(
        map((p: any) => {
          if (p?.id && t.l.type_piece && !creees[t.l.type_piece]) creees[t.l.type_piece] = p.id;
          return { fichier: t.l.fichier, ok: true, detail: `${t.l.type_piece}${t.l.numero ? ' n°' + t.l.numero : ''} ${t.l.action === 'remplacer' ? 'remplacée' : 'créée'}` };
        }),
        catchError(e => of({ fichier: t.l.fichier, ok: false, detail: this.messageErreur(e) })),
      );
    }));

    const etapeImages$ = from(groupes).pipe(concatMap(g => this.cible(g.type, creees).pipe(
      switchMap(id => this.pieces.addImages(id, g.fichiers, g.point || undefined)),
      map(() => ({ fichier: `${g.fichiers.length} image(s)`, ok: true,
                   detail: `${g.type}${g.point ? ' · point ' + g.point : ''}` })),
      catchError(e => of({ fichier: `${g.fichiers.length} image(s) ${g.type}`, ok: false, detail: this.messageErreur(e) })),
    )));

    const etapeRc$ = this.genererRc ? this.rapportDeControle() : from([] as Resultat[]);

    etapePieces$.pipe(toArray()).subscribe(r1 => {
      r1.forEach(avancer);
      etapeImages$.pipe(toArray()).subscribe(r2 => {
        r2.forEach(avancer);
        etapeRc$.pipe(toArray()).subscribe(r3 => {
          r3.forEach(avancer);
          this.etape = 'fin';
          this.termine.emit(this.reussis);
        });
      });
    });
  }

  /** Images regroupées par pièce et par point (un envoi par groupe). */
  groupesImages(): { type: string; point: string; fichiers: File[] }[] {
    const groupes = new Map<string, { type: string; point: string; fichiers: File[] }>();
    for (const img of this.imagesRetenues) {
      const f = this.depots[img.index]?.fichier;
      if (!f) continue;
      const point = (img.type_piece === 'PPA' || img.type_piece === 'PPN') ? img.point : '';
      const cle = `${img.type_piece}|${point}`;
      if (!groupes.has(cle)) groupes.set(cle, { type: img.type_piece!, point, fichiers: [] });
      groupes.get(cle)!.fichiers.push(f);
    }
    return Array.from(groupes.values());
  }

  /** Pièce qui reçoit les images d'un type : créée à l'étape précédente, existante, ou nouvelle. */
  private cible(type: string, creees: Record<string, string>): Observable<string> {
    const id = creees[type] || this.reponse?.pieces_existantes[type];
    if (id) return of(id);
    return this.pieces.createImagePiece(type, { ssdgps: this.ssdgpsId } as any).pipe(map((p: any) => {
      creees[type] = p.id;
      return p.id as string;
    }));
  }

  private rapportDeControle(): Observable<Resultat> {
    const parent = { ssdgps: this.ssdgpsId } as any;
    return this.pieces.previewComputeRc(parent).pipe(
      switchMap(apercu => {
        const existant = this.reponse?.pieces_existantes['RC'];
        return (existant ? this.service.remplacerLignes(existant, apercu.rows)
                         : this.pieces.confirmComputeRc(parent, apercu.rows, apercu.source)).pipe(
          map(() => ({ fichier: 'Rapport de contrôle', ok: true,
                       detail: `${apercu.rows.length} ligne(s) ${existant ? 'recalculées' : 'calculées'}` })));
      }),
      catchError(e => of({ fichier: 'Rapport de contrôle', ok: false, detail: this.messageErreur(e) })),
    );
  }

  get reussis(): number { return this.resultats.filter(r => r.ok).length; }

  messageErreur(e: any): string {
    const d = e?.error;
    if (!d) return 'Échec de l’import';
    if (typeof d.detail === 'string') return d.detail;
    const premier = Object.entries(d)[0] as [string, any] | undefined;
    return premier ? `${premier[0]} : ${Array.isArray(premier[1]) ? premier[1][0] : premier[1]}` : 'Échec de l’import';
  }

  fermer(): void { if (this.etape !== 'import') this.fermee.emit(); }
}
