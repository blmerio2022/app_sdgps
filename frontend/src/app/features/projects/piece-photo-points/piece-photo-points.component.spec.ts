import { of } from 'rxjs';
import { PiecePhotoPointsComponent } from './piece-photo-points.component';
import { PieceImage } from '../../../core/models/piece.model';

describe('PiecePhotoPointsComponent (logique)', () => {
  let cmp: PiecePhotoPointsComponent;

  function img(over: Partial<PieceImage>): PieceImage {
    return { id: 0, point_ref: undefined, fichier_url: 'f', format: 'png', ...over } as any;
  }

  beforeEach(() => {
    cmp = new PiecePhotoPointsComponent({} as any, {} as any);
    cmp.pieceId = 'p1';
    cmp.rows = [
      { id: 'A', nom_point: 'Point A' },
      { id: 'B', nom_point: 'Point B' },
      { nom_point: '' }, // ligne sans clé
    ];
    cmp.images = [
      img({ id: 1, point_ref: 'A' }),
      img({ id: 2, point_ref: undefined }),
      img({ id: 3, point_ref: undefined }),
    ];
  });

  describe('clés & regroupements', () => {
    it('pointKey / pointLabel', () => {
      expect(cmp.pointKey({ id: 'A' })).toBe('A');
      expect(cmp.pointLabel({ nom_point: 'Point A' })).toBe('Point A');
      expect(cmp.pointLabel({})).toBe('(point sans identifiant)');
    });
    it('validRows exclut les lignes sans clé', () => {
      expect(cmp.validRows.length).toBe(2);
    });
    it('unassigned / assignedCount', () => {
      expect(cmp.unassigned.map(i => i.id)).toEqual([2, 3]);
      expect(cmp.assignedCount).toBe(1);
    });
    it('photosOf / countOf', () => {
      expect(cmp.photosOf({ id: 'A' }).map(i => i.id)).toEqual([1]);
      expect(cmp.countOf({ id: 'B' })).toBe(0);
    });
    it('pointsWithoutPhoto', () => {
      expect(cmp.pointsWithoutPhoto).toBe(1); // B n'a pas de photo
    });
  });

  describe('affichage', () => {
    it('previewUrl privilégie l’aperçu', () => {
      expect(cmp.previewUrl(img({ apercu_url: 'a', fichier_url: 'f' }))).toBe('a');
      expect(cmp.previewUrl(img({ apercu_url: undefined, fichier_url: 'f' }))).toBe('f');
    });
    it('isDisplayable faux pour un TIFF sans aperçu', () => {
      expect(cmp.isDisplayable(img({ format: 'tiff', apercu_url: undefined }))).toBeFalse();
      expect(cmp.isDisplayable(img({ format: 'tiff', apercu_url: 'a' }))).toBeTrue();
      expect(cmp.isDisplayable(img({ format: 'png' }))).toBeTrue();
    });
  });

  describe('repli des cartes', () => {
    it('toggleCollapse / isCollapsed', () => {
      cmp.toggleCollapse({ id: 'A' });
      expect(cmp.isCollapsed({ id: 'A' })).toBeTrue();
      cmp.toggleCollapse({ id: 'A' });
      expect(cmp.isCollapsed({ id: 'A' })).toBeFalse();
    });
    it('collapseAll / expandAll / allCollapsed', () => {
      cmp.collapseAll();
      expect(cmp.allCollapsed).toBeTrue();
      cmp.expandAll();
      expect(cmp.allCollapsed).toBeFalse();
    });
  });

  describe('sélecteur de point', () => {
    it('filteredRows filtre par recherche', () => {
      cmp.pickerSearch = 'point a';
      expect(cmp.filteredRows.map(r => r.id)).toEqual(['A']);
    });
    it('openPickerForImage bascule pour une image', () => {
      cmp.openPickerForImage(5, { stopPropagation() {} } as any);
      expect(cmp.pickerForImage).toBe(5);
      cmp.openPickerForImage(5, { stopPropagation() {} } as any);
      expect(cmp.pickerForImage).toBeNull();
    });
    it('openBulkPicker bascule et ferme le picker image', () => {
      cmp.pickerForImage = 5;
      cmp.openBulkPicker({ stopPropagation() {} } as any);
      expect(cmp.bulkPickerOpen).toBeTrue();
      expect(cmp.pickerForImage).toBeNull();
    });
    it('closePicker réinitialise', () => {
      cmp.pickerForImage = 5;
      cmp.bulkPickerOpen = true;
      cmp.closePicker();
      expect(cmp.pickerForImage).toBeNull();
      expect(cmp.bulkPickerOpen).toBeFalse();
    });
  });

  describe('sélection dans le bac', () => {
    it('toggleSelect / isSelected', () => {
      cmp.toggleSelect(img({ id: 2 }), { stopPropagation() {} } as any);
      expect(cmp.isSelected(img({ id: 2 }))).toBeTrue();
      cmp.toggleSelect(img({ id: 2 }), { stopPropagation() {} } as any);
      expect(cmp.isSelected(img({ id: 2 }))).toBeFalse();
    });
    it('selectAllUnassigned / allUnassignedSelected / clearSelection', () => {
      cmp.selectAllUnassigned();
      expect(cmp.allUnassignedSelected).toBeTrue();
      cmp.clearSelection();
      expect(cmp.selectedIds.size).toBe(0);
    });
  });

  describe('glisser-déposer', () => {
    it('onDragStart ne mémorise que si éditable', () => {
      cmp.editable = false;
      cmp.onDragStart(img({ id: 2 }));
      expect(cmp.dragImageId).toBeNull();
      cmp.editable = true;
      cmp.onDragStart(img({ id: 2 }));
      expect(cmp.dragImageId).toBe(2);
      cmp.onDragEnd();
      expect(cmp.dragImageId).toBeNull();
    });
  });

  describe('lightbox', () => {
    it('openLightbox n’ouvre que si affichable', () => {
      cmp.openLightbox(img({ apercu_url: 'a', format: 'tiff' }));
      expect(cmp.lightboxUrl).toBe('a');
      cmp.closeLightbox();
      expect(cmp.lightboxUrl).toBeNull();
      cmp.openLightbox(img({ apercu_url: undefined, format: 'tiff' }));
      expect(cmp.lightboxUrl).toBeNull();
    });
  });
});

describe('PiecePhotoPointsComponent — import d’un PDF de photos', () => {
  let cmp: PiecePhotoPointsComponent;
  let pieces: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;
  const pdf = new File(['%PDF'], 'photos.pdf', { type: 'application/pdf' });
  const jpg = (n: string) => new File(['x'], n, { type: 'image/jpeg' });

  beforeEach(() => {
    pieces = jasmine.createSpyObj('PiecesService', ['addImages']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    cmp = new PiecePhotoPointsComponent(pieces, toast);
    cmp.pieceId = 'pc1';
    cmp.rows = [{ id: 'B1', nom_point: 'Borne 1' }, { id: 'B2', nom_point: 'Borne 2' }];
  });

  it('un PDF ouvre l’éditeur de pages, avec les points et le point d’origine', () => {
    const input = { files: [pdf], value: 'x' } as any;
    cmp.onFilesForPoint({ target: input } as any, cmp.rows[1]);
    expect(cmp.pdfEditing).toBe(pdf);
    expect(cmp.pdfDefaultPoint).toBe('B2');
    expect(cmp.pdfPoints).toEqual([{ ref: 'B1', label: 'Borne 1' }, { ref: 'B2', label: 'Borne 2' }]);
    expect(pieces.addImages).not.toHaveBeenCalled();
  });

  it('les pages retenues partent en un envoi par point, dans l’ordre', () => {
    pieces.addImages.and.callFake(() => of({ id: 'pc1', images: [], payload: { rows: cmp.rows } }));
    cmp.pdfEditing = pdf;
    cmp.onPdfPages([
      { file: jpg('p1.jpg'), pointRef: 'B1' }, { file: jpg('p2.jpg'), pointRef: 'B2' },
      { file: jpg('p3.jpg'), pointRef: 'B1' }, { file: jpg('p4.jpg'), pointRef: '' },
    ]);
    expect(cmp.pdfEditing).toBeNull();
    const calls = pieces.addImages.calls.allArgs().map((a: any[]) => [a[2], a[1].map((f: File) => f.name)]);
    expect(calls).toEqual([['B1', ['p1.jpg', 'p3.jpg']], ['B2', ['p2.jpg']], [undefined, ['p4.jpg']]]);
    expect(cmp.busy).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });
});
