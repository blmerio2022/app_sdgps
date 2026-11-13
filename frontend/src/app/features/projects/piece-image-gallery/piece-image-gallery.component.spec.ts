import { PieceImageGalleryComponent } from './piece-image-gallery.component';
import { PieceImage } from '../../../core/models/piece.model';

describe('PieceImageGalleryComponent', () => {
  let cmp: PieceImageGalleryComponent;

  function img(over: Partial<PieceImage>): PieceImage {
    return { id: 0, fichier_url: 'f', format: 'png', ...over } as any;
  }

  beforeEach(() => {
    cmp = new PieceImageGalleryComponent();
    cmp.images = [img({ id: 1 }), img({ id: 2 }), img({ id: 3 })];
  });

  it('setViewMode change le mode', () => {
    cmp.setViewMode('list');
    expect(cmp.viewMode).toBe('list');
  });

  it('selected renvoie l’image choisie ou la première', () => {
    expect(cmp.selected?.id).toBe(1);
    cmp.select(img({ id: 2 }));
    expect(cmp.selected?.id).toBe(2);
    cmp.images = [];
    expect(cmp.selected).toBeNull();
  });

  it('openLightbox ouvre uniquement si affichable', () => {
    cmp.openLightbox(img({ id: 2, format: 'png' }));
    expect(cmp.lightboxOpen).toBeTrue();
    expect(cmp.selectedId).toBe(2);
    cmp.closeLightbox();
    cmp.openLightbox(img({ id: 3, format: 'tiff', apercu_url: undefined }));
    expect(cmp.lightboxOpen).toBeFalse();
  });

  it('previewUrl privilégie l’aperçu', () => {
    expect(cmp.previewUrl(img({ apercu_url: 'a' }))).toBe('a');
    expect(cmp.previewUrl(img({ apercu_url: undefined, fichier_url: 'f' }))).toBe('f');
  });

  it('isDisplayable', () => {
    expect(cmp.isDisplayable(img({ format: 'tiff', apercu_url: undefined }))).toBeFalse();
    expect(cmp.isDisplayable(img({ format: 'tiff', apercu_url: 'a' }))).toBeTrue();
    expect(cmp.isDisplayable(img({ format: 'jpg' }))).toBeTrue();
  });

  it('onFilesSelected émet les fichiers', () => {
    const spy = spyOn(cmp.add, 'emit');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png')], configurable: true });
    cmp.onFilesSelected({ target: input } as any);
    expect(spy).toHaveBeenCalled();
  });

  it('confirmRemove émet l’id', () => {
    const spy = spyOn(cmp.remove, 'emit');
    cmp.confirmRemove(img({ id: 2 }), { stopPropagation() {} } as any);
    expect(spy).toHaveBeenCalledWith(2);
  });

  describe('réordonnancement', () => {
    it('moveRight échange avec le suivant', () => {
      const spy = spyOn(cmp.reorderImages, 'emit');
      cmp.moveRight(0, { stopPropagation() {} } as any);
      expect(spy).toHaveBeenCalledWith([2, 1, 3]);
    });
    it('moveLeft échange avec le précédent', () => {
      const spy = spyOn(cmp.reorderImages, 'emit');
      cmp.moveLeft(2, { stopPropagation() {} } as any);
      expect(spy).toHaveBeenCalledWith([1, 3, 2]);
    });
    it('moveLeft ne fait rien sur le premier', () => {
      const spy = spyOn(cmp.reorderImages, 'emit');
      cmp.moveLeft(0, { stopPropagation() {} } as any);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('formatage', () => {
    it('humanSize', () => {
      expect(cmp.humanSize(0)).toBe('—');
      expect(cmp.humanSize(512)).toBe('512 o');
      expect(cmp.humanSize(1536)).toBe('1.5 Ko');
      expect(cmp.humanSize(2 * 1024 * 1024)).toBe('2.0 Mo');
    });
    it('formatDate', () => {
      expect(cmp.formatDate(null)).toBe('—');
      expect(cmp.formatDate('2026-07-21T10:00:00Z')).toContain('2026');
    });
  });
});

describe('PieceImageGalleryComponent — import d’un PDF', () => {
  it('un PDF ouvre l’éditeur ; ses pages sont émises comme images', () => {
    const cmp = new PieceImageGalleryComponent();
    const emitted = jasmine.createSpy('add');
    cmp.add.subscribe(emitted);
    const pdf = new File(['%PDF'], 'rdc.pdf', { type: 'application/pdf' });
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    cmp.onFilesSelected({ target: { files: [pdf, png], value: 'x' } } as any);
    expect(cmp.pdfEditing).toBe(pdf);
    expect(emitted).toHaveBeenCalledWith([png]);              // les images passent directement
    const page = new File(['y'], 'rdc-p01.jpg', { type: 'image/jpeg' });
    cmp.onPdfPages([{ file: page, pointRef: '' }]);
    expect(cmp.pdfEditing).toBeNull();
    expect(emitted).toHaveBeenCalledWith([page]);
  });
});
