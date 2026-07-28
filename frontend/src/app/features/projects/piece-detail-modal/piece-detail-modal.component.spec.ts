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
});
