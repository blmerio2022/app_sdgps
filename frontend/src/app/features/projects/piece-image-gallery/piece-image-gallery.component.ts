import { formatDateTime } from '../../../shared/utils/date-format.util';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { PieceImage } from '../../../core/models/piece.model';

/**
 * Galerie d'images d'une pièce : vignettes, agrandissement (lightbox), panneau de
 * détails techniques par image, et — en mode `editable` — ajout multiple,
 * suppression et réordonnancement. La persistance est déléguée au parent via les
 * `@Output` (le parent appelle le service puis renvoie `images` à jour).
 */
@Component({
  selector: 'app-piece-image-gallery',
  templateUrl: './piece-image-gallery.component.html',
  styleUrls: ['./piece-image-gallery.component.scss'],
})
export class PieceImageGalleryComponent {
  @Input() images: PieceImage[] = [];
  @Input() editable = false;
  @Input() busy = false;
  @Output() add = new EventEmitter<File[]>();
  @Output() remove = new EventEmitter<number>();
  @Output() reorderImages = new EventEmitter<number[]>();

  selectedId: number | null = null;
  lightboxOpen = false;
  viewMode: 'grid' | 'list' = 'grid';

  setViewMode(mode: 'grid' | 'list'): void { this.viewMode = mode; }

  get selected(): PieceImage | null {
    if (!this.images.length) return null;
    return this.images.find(i => i.id === this.selectedId) ?? this.images[0];
  }

  select(img: PieceImage): void { this.selectedId = img.id; }
  openLightbox(img: PieceImage): void {
    if (!this.isDisplayable(img)) return;
    this.selectedId = img.id;
    this.lightboxOpen = true;
  }

  /** URL d'affichage : aperçu PNG (généré pour les TIFF) si présent, sinon l'original. */
  previewUrl(img: PieceImage): string | null { return img.apercu_url || img.fichier_url; }
  closeLightbox(): void { this.lightboxOpen = false; }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.add.emit(files);
  }

  confirmRemove(img: PieceImage, ev: Event): void {
    ev.stopPropagation();
    this.remove.emit(img.id);
  }

  moveLeft(i: number, ev: Event): void { ev.stopPropagation(); if (i > 0) this.emitSwap(i, i - 1); }
  moveRight(i: number, ev: Event): void {
    ev.stopPropagation();
    if (i < this.images.length - 1) this.emitSwap(i, i + 1);
  }
  private emitSwap(a: number, b: number): void {
    const ids = this.images.map(im => im.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    this.reorderImages.emit(ids);
  }

  /** Affichable si un aperçu PNG existe (TIFF) ou si le format est web-natif. */
  isDisplayable(img: PieceImage): boolean {
    return !!img.apercu_url || !/tiff?/i.test(img.format || '');
  }

  humanSize(bytes: number): string {
    if (!bytes) return '—';
    const units = ['o', 'Ko', 'Mo', 'Go'];
    let n = bytes, u = 0;
    while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
    return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
  }

  formatDate(v: string | null): string {
    return formatDateTime(v);
  }
}
