import { PdfPageEditorComponent } from './pdf-page-editor.component';
import { canvasToJpeg, contentBounds, PdfRenderService } from '../../../core/services/pdf-render.service';

/** Faux document : chaque page est un canvas blanc portant un carré noir. */
function fakeDoc(numPages: number) {
  const calls: { page: number; width: number; rotation: number }[] = [];
  return {
    calls,
    handle: {
      numPages,
      async renderPage(page: number, width: number, rotation = 0) {
        calls.push({ page, width, rotation });
        const c = document.createElement('canvas');
        c.width = Math.round(width); c.height = Math.round(width * 1.4);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#000'; ctx.fillRect(c.width / 4, c.height / 4, c.width / 2, c.height / 2);
        return c;
      },
      destroy: jasmine.createSpy('destroy'),
    },
  };
}

describe('PdfPageEditorComponent (logique)', () => {
  let cmp: PdfPageEditorComponent;
  let doc: ReturnType<typeof fakeDoc>;

  beforeEach(async () => {
    doc = fakeDoc(4);
    const svc = { open: jasmine.createSpy('open').and.resolveTo(doc.handle) } as any;
    cmp = new PdfPageEditorComponent(svc);
    cmp.file = new File(['%PDF'], 'Photos points.pdf', { type: 'application/pdf' });
    await cmp.ngOnInit();
  });

  const order = () => cmp.kept.map(p => p.source);

  it('charge une vignette par page, dans l’ordre du PDF', () => {
    expect(cmp.loading).toBeFalse();
    expect(order()).toEqual([1, 2, 3, 4]);
    expect(cmp.pages.every(p => p.thumb.startsWith('data:image/jpeg'))).toBeTrue();
  });

  it('un PDF illisible affiche une erreur', async () => {
    const bad = new PdfPageEditorComponent({ open: () => Promise.reject(new Error('x')) } as any);
    bad.file = cmp.file;
    await bad.ngOnInit();
    expect(bad.error).toContain('pas pu être lu');
    expect(bad.loading).toBeFalse();
  });

  it('suppression et restauration (la page restaurée revient en fin)', () => {
    cmp.remove(cmp.kept[0]);
    expect(order()).toEqual([2, 3, 4]);
    expect(cmp.deletedPages.length).toBe(1);
    cmp.restore(cmp.deletedPages[0]);
    expect(order()).toEqual([2, 3, 4, 1]);
  });

  it('suppression de la sélection', () => {
    cmp.toggleSelect(cmp.kept[1]); cmp.toggleSelect(cmp.kept[2]);
    cmp.removeSelection();
    expect(order()).toEqual([1, 4]);
    cmp.restoreAll();
    expect(cmp.deletedPages.length).toBe(0);
  });

  it('réorganisation : flèches, extrémités, glisser-déposer, ordre d’origine', () => {
    cmp.move(cmp.kept[0], 1);
    expect(order()).toEqual([2, 1, 3, 4]);
    cmp.move(cmp.kept[0], -1);                        // déjà en tête : sans effet
    expect(order()).toEqual([2, 1, 3, 4]);
    cmp.moveToEdge(cmp.kept[3], true);
    expect(order()).toEqual([4, 2, 1, 3]);
    cmp.onDragStart(0, new DragEvent('dragstart'));
    cmp.onDrop(3, new DragEvent('drop'));
    expect(order()).toEqual([2, 1, 3, 4]);
    expect(cmp.dragIndex).toBeNull();
    cmp.resetOrder();
    expect(order()).toEqual([1, 2, 3, 4]);
  });

  it('les déplacements ignorent les pages retirées', () => {
    cmp.remove(cmp.kept[1]);                          // retire p.2
    cmp.move(cmp.kept[0], 1);                         // p.1 passe après p.3
    expect(order()).toEqual([3, 1, 4]);
  });

  it('rotation : cumul modulo 360, sur une page ou la sélection', () => {
    const p = cmp.kept[0];
    cmp.rotate(p, -90);
    expect(p.rotation).toBe(270);
    cmp.rotate(p, 90); cmp.rotate(p, 90);
    expect(p.rotation).toBe(90);
    cmp.selectAll();
    cmp.rotateSelection(90);
    expect(cmp.kept.map(x => x.rotation)).toEqual([180, 90, 90, 90]);
  });

  it('sélection : tout, inverser, vider', () => {
    cmp.selectAll();
    expect(cmp.allSelected).toBeTrue();
    cmp.selectAll();
    expect(cmp.selection.length).toBe(0);
    cmp.toggleSelect(cmp.kept[0]);
    cmp.invertSelection();
    expect(cmp.selection.map(p => p.source)).toEqual([2, 3, 4]);
    cmp.clearSelection();
    expect(cmp.selection.length).toBe(0);
  });

  describe('mode points (PPA/PPN)', () => {
    beforeEach(() => { cmp.points = [{ ref: 'B1', label: 'B1' }, { ref: 'B2', label: 'B2' }]; });

    it('affecte dans l’ordre, n pages par point ; le surplus reste à assigner', () => {
      expect(cmp.pointMode).toBeTrue();
      cmp.assignInOrder();
      expect(cmp.kept.map(p => p.pointRef)).toEqual(['B1', 'B2', '', '']);
      cmp.pagesPerPoint = 2;
      cmp.assignInOrder();
      expect(cmp.kept.map(p => p.pointRef)).toEqual(['B1', 'B1', 'B2', 'B2']);
      expect(cmp.pagesOfPoint('B2')).toBe(2);
      cmp.clearAssignments();
      expect(cmp.assignedCount).toBe(0);
    });

    it('affecte la sélection à un point', () => {
      cmp.toggleSelect(cmp.kept[3]);
      cmp.assignSelection('B2');
      expect(cmp.kept[3].pointRef).toBe('B2');
      expect(cmp.assignedCount).toBe(1);
    });
  });

  it('point par défaut : toutes les pages lui sont pré-affectées', async () => {
    const c2 = new PdfPageEditorComponent({ open: () => Promise.resolve(fakeDoc(2).handle) } as any);
    c2.file = cmp.file; c2.defaultPointRef = 'B7';
    await c2.ngOnInit();
    expect(c2.pages.map(p => p.pointRef)).toEqual(['B7', 'B7']);
  });

  it('confirm() rend les pages retenues, dans l’ordre, avec leur rotation et leur point', async () => {
    cmp.points = [{ ref: 'B1', label: 'B1' }];
    cmp.remove(cmp.kept[1]);                          // retire p.2
    cmp.move(cmp.kept[2], -1);                        // ordre : 1, 4, 3
    cmp.rotate(cmp.kept[1], 90);
    cmp.kept[0].pointRef = 'B1';
    const out = jasmine.createSpy('confirmed');
    cmp.confirmed.subscribe(out);
    doc.calls.length = 0;

    await cmp.confirm();

    const results = out.calls.mostRecent().args[0];
    expect(results.map((r: any) => r.file.name)).toEqual(['Photos_points-p01.jpg', 'Photos_points-p02.jpg', 'Photos_points-p03.jpg']);
    expect(results.map((r: any) => r.pointRef)).toEqual(['B1', '', '']);
    expect(results.every((r: any) => r.file.type === 'image/jpeg' && r.file.size <= cmp.maxBytes)).toBeTrue();
    expect(doc.calls.map(c => [c.page, c.rotation])).toEqual([[1, 0], [4, 90], [3, 0]]);
    expect(cmp.exporting).toBeFalse();
  });

  it('confirm() impossible sans page retenue', async () => {
    cmp.selectAll(); cmp.removeSelection();
    expect(cmp.canConfirm).toBeFalse();
    const out = jasmine.createSpy('confirmed');
    cmp.confirmed.subscribe(out);
    await cmp.confirm();
    expect(out).not.toHaveBeenCalled();
  });

  it('rogner les marges réduit l’image au contenu', async () => {
    cmp.trimMargins = true;
    cmp.selectAll(); cmp.removeSelection(); cmp.restore(cmp.deletedPages[0]);
    const out = jasmine.createSpy('confirmed');
    cmp.confirmed.subscribe(out);
    await cmp.confirm();
    expect(out).toHaveBeenCalled();
  });

  it('ngOnDestroy libère le document', () => {
    cmp.ngOnDestroy();
    expect(doc.handle.destroy).toHaveBeenCalled();
  });
});

describe('pdf-render — utilitaires', () => {
  it('isPdf reconnaît le type ou l’extension', () => {
    expect(PdfRenderService.isPdf(new File([''], 'a.PDF'))).toBeTrue();
    expect(PdfRenderService.isPdf(new File([''], 'x', { type: 'application/pdf' }))).toBeTrue();
    expect(PdfRenderService.isPdf(new File([''], 'a.png', { type: 'image/png' }))).toBeFalse();
  });

  it('contentBounds trouve le contenu non blanc', () => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 100;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#000'; ctx.fillRect(40, 30, 20, 10);
    const b = contentBounds(c);
    expect(b.x).toBeLessThanOrEqual(40); expect(b.x).toBeGreaterThanOrEqual(38);
    expect(b.w).toBeLessThan(30);
    expect(b.h).toBeLessThan(20);
  });

  it('contentBounds garde toute une page blanche', () => {
    const c = document.createElement('canvas'); c.width = 50; c.height = 50;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 50, 50);
    expect(contentBounds(c)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });

  it('canvasToJpeg respecte la taille maximale', async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 800;
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 4000; i++) { ctx.fillStyle = `hsl(${i % 360},80%,50%)`; ctx.fillRect((i * 37) % 800, (i * 91) % 800, 9, 9); }
    const f = await canvasToJpeg(c, 'x.jpg', 40 * 1024);
    expect(f.type).toBe('image/jpeg');
    expect(f.size).toBeLessThanOrEqual(40 * 1024);
  });
});
