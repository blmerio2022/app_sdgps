import { of, throwError } from 'rxjs';
import { PieceDetailModalComponent } from './piece-detail-modal.component';

describe('PieceDetailModalComponent (helpers)', () => {
  let cmp: PieceDetailModalComponent;

  beforeEach(() => {
    cmp = new PieceDetailModalComponent({} as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('statutBadgeClass mappe les statuts', () => {
    expect(cmp.statutBadgeClass('brouillon')).toBe('badge-warning');
    expect(cmp.statutBadgeClass('valide')).toBe('badge-success');
    expect(cmp.statutBadgeClass('inconnu')).toBe('badge-secondary');
  });

  it('statutLabel renvoie la valeur brute si inconnue', () => {
    expect(cmp.statutLabel('valeur_x')).toBe('valeur_x');
  });

  it('statutIcon mappe une icône sémantique par statut', () => {
    expect(cmp.statutIcon('brouillon')).toBe('fa-pen-ruler');
    expect(cmp.statutIcon('valide')).toBe('fa-circle-check');
    expect(cmp.statutIcon('rejete')).toBe('fa-circle-xmark');
    expect(cmp.statutIcon('inconnu')).toBe('fa-circle-question');
  });

  describe('currentStatut (pastille de l’en-tête)', () => {
    it('en consultation : le statut enregistré de la pièce', () => {
      cmp.mode = 'view';
      cmp.piece = { statut: 'valide' } as any;
      (cmp as any).metaForm = { value: { statut: 'rejete' } };
      expect(cmp.currentStatut).toBe('valide');
    });

    it('en édition : la valeur en cours de saisie', () => {
      cmp.mode = 'edit';
      cmp.piece = { statut: 'valide' } as any;
      (cmp as any).metaForm = { value: { statut: 'rejete' } };
      expect(cmp.currentStatut).toBe('rejete');
    });

    it('repli sur la pièce si le formulaire n’est pas encore construit', () => {
      cmp.mode = 'edit';
      cmp.piece = { statut: 'brouillon' } as any;
      expect(cmp.currentStatut).toBe('brouillon');
    });

    it('chaîne vide si aucune donnée (pas de plantage du template)', () => {
      cmp.mode = 'view';
      expect(cmp.currentStatut).toBe('');
    });
  });

  it('autoSaving reflète les sauvegardes en cours', () => {
    expect(cmp.autoSaving).toBeFalse();
    (cmp as any).savingManual = true;
    expect(cmp.autoSaving).toBeTrue();
  });

  describe('enregistrement automatique (toujours actif, sans bascule)', () => {
    it('aucune bascule n’est exposée par le composant', () => {
      expect((cmp as any).toggleAutoSaveData).toBeUndefined();
      expect((cmp as any).autoSaveData).toBeUndefined();
    });

    it('autoSaveState dérive des drapeaux internes', () => {
      expect(cmp.autoSaveState).toBe('idle');
      cmp.autoSavedFlash = true;
      expect(cmp.autoSaveState).toBe('saved');
      (cmp as any).savingMeta = true;
      expect(cmp.autoSaveState).toBe('saving');   // « en cours » prime sur « enregistré »
    });

    it('onEditRowsChange programme une sauvegarde sans condition', () => {
      const queue = spyOn<any>(cmp, 'queueAutoSaveData');
      cmp.onEditRowsChange([{ id: 1 }]);
      expect(cmp.editRows).toEqual([{ id: 1 }] as any);
      expect(queue).toHaveBeenCalled();
    });
  });

  it('toggleReplaceMenu bascule le menu', () => {
    expect(cmp.showReplaceMenu).toBeFalse();
    cmp.toggleReplaceMenu();
    expect(cmp.showReplaceMenu).toBeTrue();
  });

  it('isImageFile selon l’extension de fichier_url', () => {
    cmp.piece = { fichier_url: 'photo.PNG' } as any;
    expect(cmp.isImageFile).toBeTrue();
    cmp.piece = { fichier_url: 'doc.pdf' } as any;
    expect(cmp.isImageFile).toBeFalse();
    cmp.piece = {} as any;
    expect(cmp.isImageFile).toBeFalse();
  });

  describe('recalcul du rapport de contrôle', () => {
    let pieces: any;
    let toast: any;
    beforeEach(() => {
      pieces = {
        previewComputeRc: jasmine.createSpy().and.returnValue(of({
          rows: [], champs: [], total_rows: 324, source: 'rdia', available_sources: ['rdn', 'rdia'] })),
        recomputeRc: jasmine.createSpy().and.returnValue(of({
          id: 'rc1', type_piece: 'RC', payload: { rows: [] },
          recalcul: { modifie: true, lignes_avant: 289, lignes_apres: 324 } })),
      };
      toast = jasmine.createSpyObj('toast', ['success', 'info', 'error']);
      cmp = new PieceDetailModalComponent(pieces, toast, {} as any, {} as any, {} as any);
      cmp.piece = { id: 'rc1', type_piece: 'RC', ssdgps: 'ss1', session: null,
                    payload: { rows: [], source_rc: 'rdia' } } as any;
      cmp.ssdgps = { verrouille: false } as any;
    });

    it('proposé pour un RC hors dossier figé seulement', () => {
      expect(cmp.canRecomputeRc).toBeTrue();
      cmp.ssdgps = { verrouille: true } as any;
      expect(cmp.canRecomputeRc).toBeFalse();
      cmp.ssdgps = { verrouille: false } as any;
      cmp.piece = { type_piece: 'LPA' } as any;
      expect(cmp.canRecomputeRc).toBeFalse();
    });

    it('aperçu avec la source du calcul précédent, puis recalcul', () => {
      const emis: any[] = [];
      cmp.saved.subscribe(p => emis.push(p));
      cmp.askRecomputeRc();
      expect(pieces.previewComputeRc).toHaveBeenCalledWith({ ssdgps: 'ss1', session: undefined }, 'rdia');
      expect(cmp.rcApercuLignes).toBe(324);
      expect(cmp.rcSources).toEqual(['rdn', 'rdia']);

      cmp.confirmRecomputeRc();
      expect(pieces.recomputeRc).toHaveBeenCalledWith('rc1', 'rdia');
      expect(cmp.showRecomputeRcConfirm).toBeFalse();
      expect((cmp.piece as any).recalcul).toBeUndefined();
      expect(toast.success).toHaveBeenCalled();
      expect(emis.length).toBe(1);
    });

    it('aperçu en échec : message affiché, recalcul impossible', () => {
      pieces.previewComputeRc.and.returnValue(throwError(() => ({ error: { detail: 'Sources manquantes' } })));
      cmp.askRecomputeRc();
      expect(cmp.rcApercuErreur).toBe('Sources manquantes');
      cmp.confirmRecomputeRc();
      expect(pieces.recomputeRc).not.toHaveBeenCalled();
    });

    it('tableau inchangé : information plutôt que succès', () => {
      pieces.recomputeRc.and.returnValue(of({ id: 'rc1', payload: { rows: [] }, recalcul: { modifie: false } }));
      cmp.confirmRecomputeRc();
      expect(toast.info).toHaveBeenCalled();
    });
  });
});
