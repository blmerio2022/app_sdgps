import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import {
  canvasToJpeg, contentBounds, PdfDocumentHandle, PdfRenderService,
} from '../../../core/services/pdf-render.service';

export type Rotation = 0 | 90 | 180 | 270;

/** Une page du PDF telle que l'opérateur l'a arrangée. */
export interface PdfPage {
  /** Identifiant stable (le n° de page d'origine, 1-indexé). */
  source: number;
  rotation: Rotation;
  deleted: boolean;
  selected: boolean;
  /** Point (PPA/PPN) auquel la page est affectée ; '' = à assigner plus tard. */
  pointRef: string;
  /** Vignette (data URL) déjà tournée. */
  thumb: string;
}

/** Une page retenue, convertie en image prête à l'envoi. */
export interface PdfPageResult { file: File; pointRef: string; }

export interface PdfPoint { ref: string; label: string; }

const THUMB_WIDTH = 220;
/** Largeur de rendu à l'export : ≈ 190 dpi pour un A4, au-delà de la résolution conseillée. */
const EXPORT_WIDTH = 1600;

/**
 * Éditeur des pages d'un PDF d'images, AVANT import.
 *
 * Cas visés : un rapport de consultation scanné en PDF, ou les photos de tous les points
 * assemblées dans un seul PDF — souvent dans le désordre, avec des pages en trop, des
 * pages couchées. L'opérateur voit chaque page, en supprime, les réordonne (flèches ou
 * glisser-déposer), les fait pivoter, rogne les marges blanches et — en mode « points »
 * (PPA/PPN) — affecte chaque page à un point. À la validation, chaque page retenue est
 * rendue en JPEG (sous `maxBytes`) et remise à l'hôte, qui l'envoie par le circuit
 * d'images habituel : rien ne change côté serveur ni dans le rapport.
 */
@Component({
  selector: 'app-pdf-page-editor',
  templateUrl: './pdf-page-editor.component.html',
  styleUrls: ['./pdf-page-editor.component.scss'],
})
export class PdfPageEditorComponent implements OnInit, OnDestroy {
  @Input() file!: File;
  /** Points disponibles : renseigné, l'éditeur passe en mode « affectation aux points ». */
  @Input() points: PdfPoint[] | null = null;
  /** Point pré-sélectionné pour toutes les pages (import lancé depuis un point précis). */
  @Input() defaultPointRef = '';
  /** Taille maximale de chaque image produite. */
  @Input() maxBytes = 2 * 1024 * 1024;
  @Output() confirmed = new EventEmitter<PdfPageResult[]>();
  @Output() cancelled = new EventEmitter<void>();

  pages: PdfPage[] = [];
  loading = true;
  loadedCount = 0;
  totalCount = 0;
  error = '';
  exporting = false;
  exportDone = 0;
  trimMargins = false;
  pagesPerPoint = 1;
  previewPage: PdfPage | null = null;
  previewUrl = '';
  dragIndex: number | null = null;
  dropIndex: number | null = null;

  private doc: PdfDocumentHandle | null = null;
  /** Vignettes NON tournées, pour regénérer la vignette tournée sans re-rendre le PDF. */
  private baseThumbs = new Map<number, HTMLCanvasElement>();
  private destroyed = false;

  constructor(private pdf: PdfRenderService) {}

  trackPage = (_: number, p: PdfPage) => p.source;

  get pointMode(): boolean { return !!this.points && this.points.length > 0; }

  async ngOnInit(): Promise<void> {
    try {
      this.doc = await this.pdf.open(this.file);
      this.totalCount = this.doc.numPages;
      for (let n = 1; n <= this.doc.numPages && !this.destroyed; n++) {
        const canvas = await this.doc.renderPage(n, THUMB_WIDTH);
        this.baseThumbs.set(n, canvas);
        this.pages.push({ source: n, rotation: 0, deleted: false, selected: false,
          pointRef: this.defaultPointRef || '', thumb: canvas.toDataURL('image/jpeg', 0.8) });
        this.loadedCount = n;
      }
    } catch {
      this.error = "Ce PDF n'a pas pu être lu (fichier protégé, corrompu ou non pris en charge).";
    } finally {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.doc?.destroy();
  }

  // --- Comptes -----------------------------------------------------------------------

  get kept(): PdfPage[] { return this.pages.filter(p => !p.deleted); }
  get deletedPages(): PdfPage[] { return this.pages.filter(p => p.deleted); }
  get selection(): PdfPage[] { return this.kept.filter(p => p.selected); }
  get assignedCount(): number { return this.kept.filter(p => !!p.pointRef).length; }
  get allSelected(): boolean { return this.kept.length > 0 && this.kept.every(p => p.selected); }
  /** Position d'une page dans l'ordre final (1-indexée), parmi les pages retenues. */
  rank(p: PdfPage): number { return this.kept.indexOf(p) + 1; }
  pointLabel(ref: string): string { return this.points?.find(p => p.ref === ref)?.label || ref; }
  pagesOfPoint(ref: string): number { return this.kept.filter(p => p.pointRef === ref).length; }

  // --- Sélection ---------------------------------------------------------------------

  toggleSelect(p: PdfPage, ev?: MouseEvent): void { ev?.stopPropagation(); p.selected = !p.selected; }
  selectAll(): void { const v = !this.allSelected; this.kept.forEach(p => (p.selected = v)); }
  invertSelection(): void { this.kept.forEach(p => (p.selected = !p.selected)); }
  clearSelection(): void { this.pages.forEach(p => (p.selected = false)); }

  // --- Rotation ----------------------------------------------------------------------

  rotate(p: PdfPage, delta: 90 | -90): void {
    p.rotation = (((p.rotation + delta) % 360) + 360) % 360 as Rotation;
    p.thumb = this.rotatedThumb(p.source, p.rotation);
    if (this.previewPage === p) this.openPreview(p);
  }
  rotateSelection(delta: 90 | -90): void { this.selection.forEach(p => this.rotate(p, delta)); }

  private rotatedThumb(source: number, rotation: Rotation): string {
    const base = this.baseThumbs.get(source);
    if (!base) return '';
    if (!rotation) return base.toDataURL('image/jpeg', 0.8);
    const c = document.createElement('canvas');
    const quarter = rotation === 90 || rotation === 270;
    c.width = quarter ? base.height : base.width;
    c.height = quarter ? base.width : base.height;
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    return c.toDataURL('image/jpeg', 0.8);
  }

  // --- Suppression -------------------------------------------------------------------

  remove(p: PdfPage): void { p.deleted = true; p.selected = false; if (this.previewPage === p) this.closePreview(); }
  restore(p: PdfPage): void {
    p.deleted = false;
    // Une page restaurée reprend sa place d'origine relative aux autres pages restaurées
    // n'a pas de sens après réorganisation : elle revient EN FIN de document.
    this.pages = [...this.pages.filter(x => x !== p), p];
  }
  removeSelection(): void { this.selection.forEach(p => this.remove(p)); }
  restoreAll(): void { this.deletedPages.forEach(p => this.restore(p)); }

  // --- Réorganisation ----------------------------------------------------------------

  /** Déplace une page retenue d'un cran (dans l'ordre des pages retenues). */
  move(p: PdfPage, dir: -1 | 1): void {
    const kept = this.kept;
    const i = kept.indexOf(p), j = i + dir;
    if (i < 0 || j < 0 || j >= kept.length) return;
    this.reorderKept(i, j);
  }
  moveToEdge(p: PdfPage, toStart: boolean): void {
    const i = this.kept.indexOf(p);
    if (i >= 0) this.reorderKept(i, toStart ? 0 : this.kept.length - 1);
  }

  /** Déplace la page retenue d'indice `from` vers l'indice `to` (indices parmi les retenues). */
  reorderKept(from: number, to: number): void {
    const kept = [...this.kept];
    const [moved] = kept.splice(from, 1);
    kept.splice(to, 0, moved);
    this.pages = [...kept, ...this.deletedPages];
  }

  /** Ordre d'origine du PDF (annule les déplacements, garde rotations et suppressions). */
  resetOrder(): void { this.pages = [...this.pages].sort((a, b) => a.source - b.source); }

  onDragStart(i: number, ev: DragEvent): void {
    this.dragIndex = i;
    ev.dataTransfer?.setData('text/plain', String(i));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  onDragOver(i: number, ev: DragEvent): void { ev.preventDefault(); this.dropIndex = i; }
  onDrop(i: number, ev: DragEvent): void {
    ev.preventDefault();
    if (this.dragIndex !== null && this.dragIndex !== i) this.reorderKept(this.dragIndex, i);
    this.onDragEnd();
  }
  onDragEnd(): void { this.dragIndex = null; this.dropIndex = null; }

  // --- Affectation aux points (PPA/PPN) ----------------------------------------------

  assign(p: PdfPage, ref: string): void { p.pointRef = ref; }
  assignSelection(ref: string): void { this.selection.forEach(p => (p.pointRef = ref)); }

  /**
   * Affecte les pages retenues aux points DANS L'ORDRE : `pagesPerPoint` pages par point,
   * en suivant l'ordre des points. Le cas courant d'un PDF de photos bien ordonné se règle
   * en un clic ; les pages en surnombre restent à assigner.
   */
  assignInOrder(): void {
    if (!this.points?.length) return;
    const per = Math.max(1, Math.floor(this.pagesPerPoint || 1));
    this.kept.forEach((p, i) => {
      const point = this.points![Math.floor(i / per)];
      p.pointRef = point ? point.ref : '';
    });
  }
  clearAssignments(): void { this.kept.forEach(p => (p.pointRef = '')); }

  // --- Aperçu ------------------------------------------------------------------------

  async openPreview(p: PdfPage): Promise<void> {
    this.previewPage = p;
    this.previewUrl = p.thumb;
    if (!this.doc) return;
    const canvas = await this.doc.renderPage(p.source, 1000, p.rotation);
    if (this.previewPage === p) this.previewUrl = canvas.toDataURL('image/jpeg', 0.9);
  }
  closePreview(): void { this.previewPage = null; this.previewUrl = ''; }
  previewStep(dir: -1 | 1): void {
    if (!this.previewPage) return;
    const kept = this.kept, i = kept.indexOf(this.previewPage) + dir;
    if (i >= 0 && i < kept.length) this.openPreview(kept[i]);
  }

  // --- Validation --------------------------------------------------------------------

  get canConfirm(): boolean { return !this.loading && !this.exporting && this.kept.length > 0; }

  baseName(): string { return (this.file?.name || 'document').replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_'); }

  async confirm(): Promise<void> {
    if (!this.canConfirm || !this.doc) return;
    this.exporting = true; this.exportDone = 0;
    try {
      const results: PdfPageResult[] = [];
      const kept = this.kept;
      for (let i = 0; i < kept.length; i++) {
        const p = kept[i];
        let canvas = await this.doc.renderPage(p.source, EXPORT_WIDTH, p.rotation);
        if (this.trimMargins) canvas = this.trim(canvas);
        const name = `${this.baseName()}-p${String(i + 1).padStart(2, '0')}.jpg`;
        results.push({ file: await canvasToJpeg(canvas, name, this.maxBytes), pointRef: p.pointRef });
        this.exportDone = i + 1;
      }
      this.confirmed.emit(results);
    } catch {
      this.error = 'La conversion des pages a échoué.';
    } finally {
      this.exporting = false;
    }
  }

  private trim(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const b = contentBounds(canvas);
    if (b.w === canvas.width && b.h === canvas.height) return canvas;
    const out = document.createElement('canvas');
    out.width = b.w; out.height = b.h;
    out.getContext('2d')!.drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    return out;
  }
}
