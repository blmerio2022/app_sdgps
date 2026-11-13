import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { forkJoin, from } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { PiecesService } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { Piece, PieceImage } from '../../../core/models/piece.model';
import { PdfRenderService } from '../../../core/services/pdf-render.service';
import { PdfPageResult, PdfPoint } from '../pdf-page-editor/pdf-page-editor.component';

/**
 * PPA / PPN : rattachement manuel des photos aux points.
 * Méthodes d'assignation (par ordre de simplicité) : bouton « Affecter » + sélecteur de
 * point, sélection & affectation en masse, et glisser-déposer (raccourci). Cartes de points
 * repliables pour compacter la liste. Composant autonome : appelle `PiecesService` puis
 * émet la pièce à jour via `(updated)`.
 */
@Component({
  selector: 'app-piece-photo-points',
  templateUrl: './piece-photo-points.component.html',
  styleUrls: ['./piece-photo-points.component.scss'],
})
export class PiecePhotoPointsComponent {
  @Input() pieceId!: string;
  @Input() rows: any[] = [];
  @Input() images: PieceImage[] = [];
  @Input() editable = false;
  @Output() updated = new EventEmitter<Piece>();

  busy = false;
  dragImageId: number | null = null;
  lightboxUrl: string | null = null;

  // Repli des cartes de points (clé = pointKey)
  collapsed = new Set<string>();
  // Sélection dans le bac « à assigner »
  selectedIds = new Set<number>();
  // Sélecteur de point : ouvert pour une photo précise, ou pour l'action groupée
  pickerForImage: number | null = null;
  bulkPickerOpen = false;
  pickerSearch = '';

  constructor(private pieces: PiecesService, private toast: ToastService) {}

  // --- Clés & libellés des points ---
  pointKey(row: any): string { return String(row?.id ?? row?.nom_point ?? '').trim(); }
  pointLabel(row: any): string { return row?.nom_point || row?.id || '(point sans identifiant)'; }
  trackRow = (_: number, row: any) => this.pointKey(row) || _;

  // --- Regroupements ---
  get validRows(): any[] { return this.rows.filter(r => this.pointKey(r)); }
  get unassigned(): PieceImage[] { return this.images.filter(i => !i.point_ref); }
  photosOf(row: any): PieceImage[] {
    const k = this.pointKey(row);
    return k ? this.images.filter(i => i.point_ref === k) : [];
  }
  countOf(row: any): number { return this.photosOf(row).length; }
  get assignedCount(): number { return this.images.filter(i => !!i.point_ref).length; }
  get pointsWithoutPhoto(): number { return this.validRows.filter(r => !this.countOf(r)).length; }

  previewUrl(img: PieceImage): string | null { return img.apercu_url || img.fichier_url; }
  isDisplayable(img: PieceImage): boolean { return !!img.apercu_url || !/tiff?/i.test(img.format || ''); }

  // --- Repli des cartes ---
  isCollapsed(row: any): boolean { return this.collapsed.has(this.pointKey(row)); }
  toggleCollapse(row: any): void {
    const k = this.pointKey(row);
    this.collapsed.has(k) ? this.collapsed.delete(k) : this.collapsed.add(k);
  }
  collapseAll(): void { this.validRows.forEach(r => this.collapsed.add(this.pointKey(r))); }
  expandAll(): void { this.collapsed.clear(); }
  get allCollapsed(): boolean { return this.validRows.length > 0 && this.validRows.every(r => this.isCollapsed(r)); }

  // --- Upload ---
  onFilesForPoint(ev: Event, row: any): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []); input.value = '';
    if (files.length) this.addPhotos(files, this.pointKey(row));
  }
  onFilesUnassigned(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []); input.value = '';
    if (files.length) this.addPhotos(files, '');
  }
  // --- PDF de photos : pages triées puis affectées aux points ------------------------
  pdfEditing: File | null = null;
  /** Point d'où l'import a été lancé : pré-affecte toutes les pages à ce point. */
  pdfDefaultPoint = '';

  /** Points proposés à l'éditeur de pages (même clé que l'affectation des photos). */
  get pdfPoints(): PdfPoint[] {
    return this.validRows.map(r => ({ ref: this.pointKey(r), label: this.pointLabel(r) }));
  }

  /** Pages retenues : un envoi PAR POINT (l'API affecte un lot d'images à un point), en
   * séquence pour garder l'ordre des pages et un seul `busy`. */
  onPdfPages(results: PdfPageResult[]): void {
    this.pdfEditing = null;
    if (!results.length) return;
    const groups = new Map<string, File[]>();
    results.forEach(r => groups.set(r.pointRef, [...(groups.get(r.pointRef) || []), r.file]));
    this.busy = true;
    from([...groups.entries()]).pipe(
      concatMap(([ref, files]) => this.pieces.addImages(this.pieceId, files, ref || undefined)),
    ).subscribe({
      next: p => this.apply(p),
      error: e => { this.busy = false; this.toast.error('Échec', e?.error?.detail || 'Ajout des pages impossible'); },
      complete: () => {
        this.busy = false;
        const assigned = results.filter(r => r.pointRef).length;
        this.toast.success('PDF importé', `${results.length} page(s) ajoutée(s), dont ${assigned} affectée(s) à un point.`);
      },
    });
  }

  private addPhotos(files: File[], pointRef: string): void {
    // Un PDF passe d'abord par l'éditeur de pages (tri, rotation, affectation aux points).
    const pdf = files.find(f => PdfRenderService.isPdf(f));
    if (pdf) {
      this.pdfDefaultPoint = pointRef;
      this.pdfEditing = pdf;
      files = files.filter(f => !PdfRenderService.isPdf(f));
      if (!files.length) return;
    }
    const valid = files.filter(f => /\.(png|jpe?g|tiff?|webp)$/i.test(f.name) && f.size <= 20 * 1024 * 1024);
    if (valid.length < files.length) {
      this.toast.error('Fichier(s) ignoré(s)', 'Formats : png/jpg/jpeg/tiff/webp/pdf, max 20 Mo.');
    }
    if (!valid.length || this.busy) return;
    this.busy = true;
    this.pieces.addImages(this.pieceId, valid, pointRef || undefined).subscribe({
      next: p => { this.busy = false; this.apply(p); this.toast.success('Succès', `${valid.length} photo(s) ajoutée(s)`); },
      error: e => { this.busy = false; this.toast.error('Échec', e?.error?.detail || 'Ajout impossible'); },
    });
  }

  removePhoto(img: PieceImage, ev: Event): void {
    ev.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.pieces.deleteImage(this.pieceId, img.id).subscribe({
      next: p => { this.busy = false; this.apply(p); this.toast.success('Succès', 'Photo supprimée'); },
      error: e => { this.busy = false; this.toast.error('Échec', e?.error?.detail || 'Suppression impossible'); },
    });
  }

  private assign(imageId: number, pointRef: string): void {
    if (this.busy) return;
    this.busy = true;
    this.pieces.assignImage(this.pieceId, imageId, pointRef).subscribe({
      next: p => { this.busy = false; this.apply(p); },
      error: () => { this.busy = false; this.toast.error('Échec', 'Assignation impossible'); },
    });
  }

  private apply(p: Piece): void {
    this.images = p.images || [];
    // Purger la sélection des images qui ne sont plus dans le bac.
    const stillUnassigned = new Set(this.unassigned.map(i => i.id));
    this.selectedIds.forEach(id => { if (!stillUnassigned.has(id)) this.selectedIds.delete(id); });
    this.updated.emit(p);
  }

  // --- Sélecteur de point (menu réutilisable) ---
  get filteredRows(): any[] {
    const q = this.pickerSearch.trim().toLowerCase();
    const rows = this.validRows;
    return q ? rows.filter(r => this.pointLabel(r).toLowerCase().includes(q)) : rows;
  }
  openPickerForImage(imageId: number, ev: Event): void {
    ev.stopPropagation();
    this.pickerSearch = '';
    this.bulkPickerOpen = false;
    this.pickerForImage = this.pickerForImage === imageId ? null : imageId;
  }
  openBulkPicker(ev: Event): void {
    ev.stopPropagation();
    this.pickerSearch = '';
    this.pickerForImage = null;
    this.bulkPickerOpen = !this.bulkPickerOpen;
  }
  closePicker(): void { this.pickerForImage = null; this.bulkPickerOpen = false; }
  chooseForImage(row: any): void {
    const id = this.pickerForImage;
    this.closePicker();
    if (id != null) this.assign(id, this.pointKey(row));
  }
  chooseForBulk(row: any): void {
    this.closePicker();
    this.assignBulk(this.pointKey(row));
  }
  // Références stables passées au template du sélecteur (ngTemplateOutletContext).
  imagePick = (row: any) => this.chooseForImage(row);
  bulkPick = (row: any) => this.chooseForBulk(row);

  // --- Sélection dans le bac ---
  isSelected(img: PieceImage): boolean { return this.selectedIds.has(img.id); }
  toggleSelect(img: PieceImage, ev: Event): void {
    ev.stopPropagation();
    this.selectedIds.has(img.id) ? this.selectedIds.delete(img.id) : this.selectedIds.add(img.id);
  }
  selectAllUnassigned(): void { this.unassigned.forEach(i => this.selectedIds.add(i.id)); }
  clearSelection(): void { this.selectedIds.clear(); }
  get allUnassignedSelected(): boolean {
    return this.unassigned.length > 0 && this.unassigned.every(i => this.selectedIds.has(i.id));
  }

  // --- Affectation / suppression en masse ---
  private assignBulk(pointRef: string): void {
    const ids = [...this.selectedIds];
    if (!ids.length || this.busy) return;
    this.busy = true;
    this.pieces.assignImagesBulk(this.pieceId, ids, pointRef).subscribe({
      next: p => { this.busy = false; this.apply(p); this.toast.success('Succès', `${ids.length} photo(s) affectée(s)`); },
      error: () => { this.busy = false; this.toast.error('Échec', 'Affectation en masse impossible'); },
    });
  }
  deleteSelected(): void {
    const ids = [...this.selectedIds];
    if (!ids.length || this.busy) return;
    this.busy = true;
    forkJoin(ids.map(id => this.pieces.deleteImage(this.pieceId, id))).subscribe({
      next: results => {
        this.busy = false;
        const last = results[results.length - 1];
        this.apply(last); this.clearSelection();
        this.toast.success('Succès', `${ids.length} photo(s) supprimée(s)`);
      },
      error: () => { this.busy = false; this.toast.error('Échec', 'Suppression en masse impossible'); },
    });
  }

  // --- Glisser-déposer (raccourci) ---
  onDragStart(img: PieceImage): void { if (this.editable) this.dragImageId = img.id; }
  onDragEnd(): void { this.dragImageId = null; }
  allowDrop(ev: DragEvent): void { if (this.editable && this.dragImageId != null) ev.preventDefault(); }
  onDropOnPoint(row: any, ev: DragEvent): void {
    ev.preventDefault();
    if (this.dragImageId != null) this.assign(this.dragImageId, this.pointKey(row));
    this.dragImageId = null;
  }
  onDropUnassign(ev: DragEvent): void {
    ev.preventDefault();
    if (this.dragImageId != null) this.assign(this.dragImageId, '');
    this.dragImageId = null;
  }

  openLightbox(img: PieceImage): void {
    const u = this.previewUrl(img);
    if (u && this.isDisplayable(img)) this.lightboxUrl = u;
  }
  closeLightbox(): void { this.lightboxUrl = null; }

  @HostListener('document:click')
  onDocClick(): void { this.closePicker(); }
}
