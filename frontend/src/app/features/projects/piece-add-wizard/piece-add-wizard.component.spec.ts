import { FormBuilder } from '@angular/forms';
import { PieceAddWizardComponent } from './piece-add-wizard.component';
import { PieceTypeDef } from '../../../core/models/piece.model';

describe('PieceAddWizardComponent (logique)', () => {
  let cmp: PieceAddWizardComponent;
  let toast: jasmine.SpyObj<{ success: any; error: any }>;
  const fb = new FormBuilder();

  function def(over: any = {}): PieceTypeDef {
    return { code: 'RDL', nom: 'Rattachement', source: 'csv_manuel', natures: 'toutes', champs: [], ...over } as any;
  }

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    cmp = new PieceAddWizardComponent({} as any, toast as any, fb, {} as any, {} as any);
    cmp.ssdgps = { id: 's1', type_ssdgps: 'mono-session', nature_ssdgps: 'rattachement' } as any;
    cmp.catalog = [];
    cmp.existingPieces = [];
  });

  describe('stepper', () => {
    it('mono-session : 2 étapes (type, source) — pas d’étape Session', () => {
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'source']);
    });

    it('multi-session : 3 étapes, Session insérée au milieu', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'scope', 'source']);
    });

    it('currentStepIndex suit l’étape courante', () => {
      expect(cmp.currentStepIndex).toBe(0);
      cmp.step = 'source';
      expect(cmp.currentStepIndex).toBe(1);
    });

    it('l’étape « photos » reste rattachée au dernier rang (prolonge la source)', () => {
      cmp.step = 'photos';
      expect(cmp.currentStepIndex).toBe(1);
    });

    it('goToStep revient à une étape déjà franchie', () => {
      cmp.selectType(def());
      expect(cmp.step).toBe('source');
      cmp.goToStep(0);
      expect(cmp.step).toBe('type');
      expect(cmp.selectedType).toBeNull();
    });

    it('goToStep ignore l’étape courante et les étapes à venir', () => {
      cmp.selectType(def());
      cmp.goToStep(1);           // étape courante
      expect(cmp.step).toBe('source');
      cmp.step = 'type';
      cmp.goToStep(1);           // étape à venir
      expect(cmp.step).toBe('type');
    });
  });

  describe('cartes de type', () => {
    it('existingCount compte les pièces du type, hors corbeille', () => {
      cmp.existingPieces = [
        { type_piece: 'RDL' }, { type_piece: 'RDL', is_deleted: true }, { type_piece: 'ROB' },
      ] as any;
      expect(cmp.existingCount(def())).toBe(1);
      expect(cmp.existingCount(def({ code: 'ROB' }))).toBe(1);
      expect(cmp.existingCount(def({ code: 'RDC' }))).toBe(0);
    });

    it('sourceLabel / sourceIcon décrivent la source attendue', () => {
      expect(cmp.sourceLabel(def({ source: 'image' }))).toBe('Images');
      expect(cmp.sourceLabel(def({ source: 'csv_manuel' }))).toBe('Tableau');
      expect(cmp.sourceLabel(def({ computed: true }))).toBe('Calculée');
      expect(cmp.sourceLabel(def({ assemble: true }))).toBe('Assemblée');
      expect(cmp.sourceIcon(def({ source: 'image' }))).toBe('fa-image');
      expect(cmp.sourceIcon(def({ computed: true }))).toBe('fa-calculator');
    });
  });

  describe('niveau & sélection du type', () => {
    it('isMulti reflète le type de SSDGPS', () => {
      expect(cmp.isMulti).toBeFalse();
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      expect(cmp.isMulti).toBeTrue();
    });

    it('selectType (mono) va directement à la source', () => {
      cmp.selectType(def());
      expect(cmp.selectedNiveau).toBe('ssdgps');
      expect(cmp.step).toBe('source');
    });

    it('selectType (multi) va à l’étape scope avec session par défaut', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      cmp.defaultSessionId = 'sess1';
      cmp.selectType(def());
      expect(cmp.step).toBe('scope');
      expect(cmp.selectedSessionId).toBe('sess1');
    });

    it('chooseNiveauSession fixe la session et passe à source', () => {
      cmp.chooseNiveauSession('sess2');
      expect(cmp.selectedNiveau).toBe('session');
      expect(cmp.selectedSessionId).toBe('sess2');
      expect(cmp.step).toBe('source');
    });

    it('selectedSessionNumero résout le numéro', () => {
      cmp.sessions = [{ id: 'sess1', numero_session: 4 } as any];
      cmp.selectedSessionId = 'sess1';
      expect(cmp.selectedSessionNumero).toBe(4);
    });

    it('backToType / backToNiveau réinitialisent', () => {
      cmp.selectType(def());
      cmp.backToType();
      expect(cmp.step).toBe('type');
      expect(cmp.selectedType).toBeNull();
    });
  });

  describe('applicableTypes', () => {
    it('exclut les types « ui » et filtre par nature', () => {
      cmp.catalog = [
        def({ code: 'A', source: 'ui' }),
        def({ code: 'B', natures: ['rattachement'] }),
        def({ code: 'C', natures: ['autre'] }),
        def({ code: 'D', natures: 'toutes' }),
      ];
      expect(cmp.applicableTypes.map(t => t.code as string)).toEqual(['B', 'D']);
    });
  });

  describe('sourceAllows', () => {
    it('image selon la source du type', () => {
      cmp.selectedType = def({ source: 'image_csv_manuel' });
      expect(cmp.sourceAllows('image')).toBeTrue();
      expect(cmp.sourceAllows('csv')).toBeTrue();
      expect(cmp.sourceAllows('manuel')).toBeTrue();
      cmp.selectedType = def({ source: 'manuel' });
      expect(cmp.sourceAllows('image')).toBeFalse();
      expect(cmp.sourceAllows('csv')).toBeFalse();
      expect(cmp.sourceAllows('manuel')).toBeTrue();
    });
    it('faux sans type sélectionné', () => {
      cmp.selectedType = null;
      expect(cmp.sourceAllows('manuel')).toBeFalse();
    });
  });

  describe('numérotation', () => {
    it('nextNumero undefined pour un type non répétable', () => {
      cmp.selectedType = def({ repeatable: false });
      expect((cmp as any).nextNumero()).toBeUndefined();
    });
    it('nextNumero incrémente par scope (type + session)', () => {
      cmp.selectedType = def({ code: 'RDN', repeatable: true });
      cmp.selectedSessionId = null;
      cmp.existingPieces = [
        { type_piece: 'RDN', numero: 1, session: null } as any,
        { type_piece: 'RDN', numero: 2, session: null } as any,
        { type_piece: 'RDN', numero: 9, session: 'other' } as any,
      ];
      expect((cmp as any).nextNumero()).toBe(3);
    });
    it('maxPosition = pièces actives + 1', () => {
      cmp.existingPieces = [{ is_deleted: false } as any, { is_deleted: true } as any];
      expect(cmp.maxPosition).toBe(2);
    });
  });

  describe('position d’insertion (contrôle segmenté)', () => {
    it('setInsertAtEnd bascule le mode', () => {
      cmp.setInsertAtEnd(true);
      expect(cmp.insertAtEnd).toBeTrue();
      cmp.setInsertAtEnd(false);
      expect(cmp.insertAtEnd).toBeFalse();
    });
  });

  describe('formatSessionDate', () => {
    it('formate la date de session (sans heure)', () => {
      expect(cmp.formatSessionDate({ date_session: '2026-03-15' } as any)).toBe('15/03/2026');
    });
    it('renvoie le marqueur « — » quand la date n’est pas renseignée', () => {
      expect(cmp.formatSessionDate({ date_session: null } as any)).toBe('—');
    });
  });

  describe('PPA/PPN (photos par point)', () => {
    it('isPhotoPoints détecte le champ fichier_image', () => {
      cmp.selectedType = def({ champs: [{ name: 'fichier_image' } as any] });
      expect(cmp.isPhotoPoints).toBeTrue();
    });
    it('pointsSansPhoto liste les points non couverts', () => {
      cmp.createdPiece = {
        payload: { rows: [{ nom_point: 'A' }, { nom_point: 'B' }] },
        images: [{ point_ref: 'A' }],
      } as any;
      expect(cmp.pointsSansPhoto).toEqual(['B']);
      expect(cmp.canFinishPhotos).toBeFalse();
    });
    it('finishPhotos bloque tant qu’un point manque', () => {
      cmp.createdPiece = { payload: { rows: [{ nom_point: 'A' }] }, images: [] } as any;
      const spy = spyOn(cmp.created, 'emit');
      cmp.finishPhotos();
      expect(toast.error).toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('images locales', () => {
    beforeEach(() => {
      cmp.selectedImages = [new File(['a'], 'a.png'), new File(['b'], 'b.png')];
      cmp.selectedImagePreviews = ['ua', 'ub'];
      spyOn(URL, 'revokeObjectURL');
    });
    it('moveLocalImage échange deux images', () => {
      cmp.moveLocalImage(0, 1);
      expect(cmp.selectedImages.map(f => f.name)).toEqual(['b.png', 'a.png']);
      expect(cmp.selectedImagePreviews).toEqual(['ub', 'ua']);
    });
    it('removeLocalImage retire et révoque l’URL', () => {
      cmp.removeLocalImage(0);
      expect(cmp.selectedImages.map(f => f.name)).toEqual(['b.png']);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('ua');
    });
    it('isPreviewable faux pour un TIFF', () => {
      expect(cmp.isPreviewable(new File(['x'], 'p.tiff'))).toBeFalse();
      expect(cmp.isPreviewable(new File(['x'], 'p.png'))).toBeTrue();
    });
  });

  describe('création en masse (bulk)', () => {
    it('supportsBulkHtml exige repeatable + html_import', () => {
      cmp.selectedType = def({ repeatable: true, html_import: true } as any);
      expect(cmp.supportsBulkHtml).toBeTrue();
      cmp.selectedType = def({ repeatable: true } as any);
      expect(cmp.supportsBulkHtml).toBeFalse();
    });
    it('moveBulk / removeBulk réordonnent la liste', () => {
      cmp.bulkCandidates = [{ source: 'a' }, { source: 'b' }] as any;
      cmp.moveBulk(0, 1);
      expect(cmp.bulkCandidates.map(c => c.source)).toEqual(['b', 'a']);
      cmp.removeBulk(0);
      expect(cmp.bulkCandidates.map(c => c.source)).toEqual(['a']);
    });
    it('bulkNumeroFor décale depuis nextNumero', () => {
      cmp.selectedType = def({ code: 'RDN', repeatable: true });
      cmp.existingPieces = [];
      expect(cmp.bulkNumeroFor(0)).toBe(1);
      expect(cmp.bulkNumeroFor(2)).toBe(3);
    });
  });

  describe('assemblage', () => {
    it('supportsAssemble', () => {
      cmp.selectedType = def({ assemble: true } as any);
      expect(cmp.supportsAssemble).toBeTrue();
    });
    it('assembleSelectedIds ne garde que les cochés', () => {
      cmp.assembleItems = [
        { id: '1', label: 'Libre', count: 2, selected: true },
        { id: '2', label: 'N°1', count: 1, selected: false },
      ];
      expect(cmp.assembleSelectedIds).toEqual(['1']);
    });
    it('moveAssemble échange', () => {
      cmp.assembleItems = [{ id: '1' }, { id: '2' }] as any;
      cmp.moveAssemble(0, 1);
      expect(cmp.assembleItems.map(x => x.id)).toEqual(['2', '1']);
    });
    it('rcSourceLabel', () => {
      expect(cmp.rcSourceLabel('rdia')).toContain('RDIA');
      expect(cmp.rcSourceLabel('rdn')).toContain('RDN');
    });
  });

  describe('tri des fichiers de déterminations', () => {
    it('sortAssembleFiles bascule le sens si déjà actif', () => {
      cmp.assembleFileItems = [];
      cmp.assembleSortKey = 'fixe';
      cmp.assembleSortDir = 1;
      cmp.sortAssembleFiles('fixe');
      expect(cmp.assembleSortDir as number).toBe(-1);
      cmp.sortAssembleFiles('name');
      expect(cmp.assembleSortKey).toBe('name');
      expect(cmp.assembleSortDir).toBe(1);
    });
    it('moveAssembleFile passe en ordre manuel', () => {
      cmp.assembleFileItems = [
        { filename: 'a', hasFixe: true, fixes: ['x'], label: '', count: 0, lastModified: 0, rows: [] },
        { filename: 'b', hasFixe: true, fixes: ['y'], label: '', count: 0, lastModified: 0, rows: [] },
      ];
      cmp.moveAssembleFile(0, 1);
      expect(cmp.assembleFileItems.map(f => f.filename)).toEqual(['b', 'a']);
      expect(cmp.assembleSortKey).toBeNull();
    });
    it('resetAssembleFiles vide la liste', () => {
      cmp.assembleFileItems = [{ filename: 'a' } as any];
      cmp.resetAssembleFiles();
      expect(cmp.assembleFileItems).toEqual([]);
      expect(cmp.assembleSortKey).toBe('fixe');
    });
  });

  describe('grille manuelle', () => {
    beforeEach(() => {
      cmp.selectedType = def({ champs: [{ name: 'x', label: 'X' } as any, { name: 'y', label: 'Y' } as any] });
      (cmp as any).initManualForm();
    });
    it('démarre avec une ligne', () => {
      expect(cmp.manualRows.length).toBe(1);
    });
    it('addManualRow / removeManualRow', () => {
      cmp.addManualRow();
      expect(cmp.manualRows.length).toBe(2);
      cmp.removeManualRow(0);
      expect(cmp.manualRows.length).toBe(1);
      cmp.removeManualRow(0); // ne descend pas sous 1
      expect(cmp.manualRows.length).toBe(1);
    });
    it('confirmClearRows vide toutes les lignes', () => {
      cmp.addManualRow();
      cmp.clearManualRows();
      expect(cmp.showClearConfirm).toBeTrue();
      cmp.confirmClearRows();
      expect(cmp.manualRows.length).toBe(0);
      expect(cmp.showClearConfirm).toBeFalse();
    });
  });

  describe('manualChamps (filtre-maître import)', () => {
    it('renvoie tous les champs sans config', () => {
      cmp.selectedType = def({ champs: [{ name: 'x' } as any, { name: 'y' } as any] });
      (cmp as any).fieldsConfig = {};
      expect(cmp.manualChamps.map(c => c.name)).toEqual(['x', 'y']);
    });
    it('réordonne selon la vue import et conserve les requis', () => {
      cmp.selectedType = def({ champs: [
        { name: 'x' } as any, { name: 'y' } as any, { name: 'z', required: true } as any,
      ] });
      (cmp as any).fieldsConfig = { RDL: { import: { brut: ['y', 'x'] } } };
      // z requis → réinjecté en tête
      expect(cmp.manualChamps.map(c => c.name)).toEqual(['z', 'y', 'x']);
    });
  });

  describe('errorMessage (privé)', () => {
    const em = (e: any) => (cmp as any).errorMessage(e, 'repli');
    it('chaîne directe', () => {
      expect(em({ error: 'boom' })).toBe('boom');
    });
    it('detail', () => {
      expect(em({ error: { detail: 'introuvable' } })).toBe('introuvable');
    });
    it('erreur par champ (tableau)', () => {
      expect(em({ error: { code: ['déjà pris'] } })).toBe('déjà pris');
    });
    it('repli', () => {
      expect(em({})).toBe('repli');
    });
  });

  it('close émet cancelled', () => {
    const spy = spyOn(cmp.cancelled, 'emit');
    cmp.close();
    expect(spy).toHaveBeenCalled();
  });
});
