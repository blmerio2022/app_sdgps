import { PieceDetailPageComponent } from './piece-detail-page.component';

describe('PieceDetailPageComponent (logique)', () => {
  let cmp: PieceDetailPageComponent;
  let router: jasmine.SpyObj<{ navigate: any }>;
  let breadcrumb: jasmine.SpyObj<{ set: any; clear: any }>;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    (router as any).url = '/projets/p1/pieces/s1/piece/pi1';
    breadcrumb = jasmine.createSpyObj('BreadcrumbService', ['set', 'clear']);
    cmp = new PieceDetailPageComponent(
      {} as any, {} as any, {} as any, router as any, {} as any, breadcrumb as any,
    );
    (cmp as any).projectId = 'p1';
    (cmp as any).ssdgpsId = 's1';
    (cmp as any).pieceId = 'pi1';
  });

  it('catalogDef trouve la définition du type', () => {
    cmp.catalog = [{ code: 'RDL', nom: 'Rattachement' } as any];
    cmp.piece = { type_piece: 'RDL' } as any;
    expect(cmp.catalogDef?.nom).toBe('Rattachement');
  });

  it('onSaved met à jour la pièce', () => {
    const updated = { id: 'pi1' } as any;
    cmp.onSaved(updated);
    expect(cmp.piece).toBe(updated);
  });

  it('backToList navigue vers la gestion des pièces', () => {
    (cmp as any).proprieteId = 'prop1';
    cmp.backToList();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/projets', 'p1', 'pieces', 's1'],
      { queryParams: jasmine.objectContaining({ proprieteId: 'prop1' }) },
    );
  });

  describe('bascule Consultation / Modification', () => {
    it('goToEdit navigue vers la page de modification', () => {
      cmp.mode = 'view';
      cmp.goToEdit();
      expect(router.navigate).toHaveBeenCalledWith(
        ['/projets', 'p1', 'pieces', 's1', 'piece', 'pi1', 'modifier'],
        jasmine.any(Object),
      );
    });

    it('goToView revient à la page de consultation (route sœur, sans « modifier »)', () => {
      cmp.mode = 'edit';
      cmp.goToView();
      expect(router.navigate).toHaveBeenCalledWith(
        ['/projets', 'p1', 'pieces', 's1', 'piece', 'pi1'],
        jasmine.any(Object),
      );
    });

    it('conserve le contexte de navigation dans les query params', () => {
      (cmp as any).proprieteId = 'prop1';
      (cmp as any).affaireId = 'aff1';
      (cmp as any).sessionId = 'se1';
      cmp.mode = 'edit';
      cmp.goToView();
      expect(router.navigate).toHaveBeenCalledWith(jasmine.any(Array), {
        queryParams: { proprieteId: 'prop1', affaireId: 'aff1', session: 'se1' },
      });
    });

    it('basculer vers le mode courant ne navigue pas', () => {
      cmp.mode = 'edit';
      cmp.switchMode('edit');
      cmp.mode = 'view';
      cmp.switchMode('view');
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  it('onAutoSaveState mémorise l’état remonté par le composant hébergé', () => {
    expect(cmp.autoSaveState).toBe('idle');
    cmp.onAutoSaveState('saving');
    expect(cmp.autoSaveState).toBe('saving');
    cmp.onAutoSaveState('saved');
    expect(cmp.autoSaveState).toBe('saved');
  });

  it('ngOnDestroy efface le fil d’Ariane', () => {
    cmp.ngOnDestroy();
    expect(breadcrumb.clear).toHaveBeenCalled();
  });

  describe('updateTopbarBreadcrumb (privé)', () => {
    it('construit un fil métier complet avec propriété, affaire, SSDGPS et pièce active', () => {
      (cmp as any).proprieteId = 'prop1';
      (cmp as any).affaireId = 'aff1';
      cmp.ssdgps = {
        id: 's1', numero_ssdgps: 5, type_ssdgps: 'mono-session',
        propriete_id_titre: 'TF-123', affaire_numero: 9,
      } as any;
      (cmp as any).projet = { nom_projet: 'Mon Projet' };
      cmp.piece = { type_piece: 'RDL', numero: 2 } as any;

      (cmp as any).updateTopbarBreadcrumb();
      const trail = breadcrumb.set.calls.mostRecent().args[0];
      const labels = trail.map((t: any) => t.label);
      expect(labels).toContain('Accueil');
      expect(labels).toContain('Mon Projet');
      expect(labels).toContain('TF-123');
      expect(labels).toContain('SD 9');
      expect(labels).toContain('SSDGPS 5');
      expect(labels).toContain('Pièces');
      expect(trail[trail.length - 1].isActive).toBeTrue();
      expect(trail[trail.length - 1].label).toBe('RDL n°2');
    });

    it('ne publie rien sans SSDGPS', () => {
      (cmp as any).ssdgps = undefined;
      (cmp as any).updateTopbarBreadcrumb();
      expect(breadcrumb.set).not.toHaveBeenCalled();
    });
  });
});
