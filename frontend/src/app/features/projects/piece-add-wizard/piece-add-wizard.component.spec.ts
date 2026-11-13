import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';
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

  describe('stepper — sous-étapes de la source', () => {
    it('avant tout choix de type : la phase source est une pastille unique', () => {
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'data']);
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'scope', 'data']);
    });

    it('multi-session AVEC session de contexte : aucune étape « Session »', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      cmp.defaultSessionId = 'sess1';
      expect(cmp.needsSessionStep).toBeFalse();
      expect(cmp.wizardSteps.map(s => s.key)).not.toContain('scope');
    });

    it('needsSessionStep : vrai seulement si multi-session ET aucune session de contexte', () => {
      expect(cmp.needsSessionStep).toBeFalse();               // mono-session
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      expect(cmp.needsSessionStep).toBeTrue();                // multi sans contexte
      cmp.defaultSessionId = 'sess1';
      expect(cmp.needsSessionStep).toBeFalse();               // multi avec contexte
    });

    it('type multi-méthodes : Méthode + Données + Placement', () => {
      cmp.selectType(def());   // csv_manuel → 2 méthodes
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'method', 'data', 'place']);
    });

    it('type mono-méthode : pas de sous-étape Méthode', () => {
      cmp.selectType(def({ source: 'manuel' }));
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'data', 'place']);
    });

    it('type à photos par point : ajoute la sous-étape Photos', () => {
      cmp.selectType(def({ source: 'image_csv_manuel', champs: [{ name: 'fichier_image' } as any] }));
      expect(cmp.wizardSteps.map(s => s.key)).toContain('photos');
    });

    it('currentStepIndex suit l’étape courante', () => {
      cmp.selectType(def());   // step = method (index 1)
      expect(cmp.currentStepIndex).toBe(1);
      cmp.step = 'place';
      expect(cmp.currentStepIndex).toBe(3);
    });

    it('goToStep revient à une étape déjà franchie', () => {
      cmp.selectType(def());
      cmp.step = 'place';        // simule une progression
      cmp.goToStep(0);
      expect(cmp.step).toBe('type');
      expect(cmp.selectedType).toBeNull();
    });

    it('goToStep ignore l’étape courante et les étapes à venir', () => {
      cmp.selectType(def());     // method (index 1)
      cmp.goToStep(1);           // étape courante
      expect(cmp.step).toBe('method');
      cmp.goToStep(2);           // étape à venir (data)
      expect(cmp.step).toBe('method');
    });
  });

  describe('phase source — sous-étapes', () => {
    it('sourceChoices reflète les méthodes disponibles', () => {
      cmp.selectedType = def({ source: 'image_csv_manuel' });
      expect(cmp.sourceChoices.map(m => m.id)).toEqual(['image', 'csv', 'manuel']);
      cmp.selectedType = def({ source: 'manuel' });
      expect(cmp.sourceChoices.map(m => m.id)).toEqual(['manuel']);
      cmp.selectedType = def({ source: 'calcul', computed: true });
      expect(cmp.sourceChoices.map(m => m.id)).toEqual(['compute']);
      cmp.selectedType = def({ source: 'manuel', assemble: true });
      expect(cmp.sourceChoices.map(m => m.id)).toEqual(['manuel', 'assemble', 'assemble-files']);
    });

    it('isImageOnly : vrai seulement si l’image est la SEULE méthode', () => {
      cmp.selectedType = def({ source: 'image' });          // RDC & co.
      expect(cmp.isImageOnly).toBeTrue();
      cmp.selectedType = def({ source: 'image_csv_manuel' }); // image + csv + manuel
      expect(cmp.isImageOnly).toBeFalse();
      cmp.selectedType = def({ source: 'manuel' });
      expect(cmp.isImageOnly).toBeFalse();
      // Photos par point (PPA/PPN) : l'image n'est pas une méthode de saisie du tableau.
      cmp.selectedType = def({ source: 'image', champs: [{ name: 'fichier_image' } as any] });
      expect(cmp.isImageOnly).toBeFalse();
    });

    it('image masquée pour un type à photos par point', () => {
      cmp.selectedType = def({ source: 'image_csv_manuel', champs: [{ name: 'fichier_image' } as any] });
      expect(cmp.sourceChoices.map(m => m.id)).toEqual(['csv', 'manuel']);
    });

    it('un type mono-méthode saute la sous-étape Méthode', () => {
      cmp.selectType(def({ source: 'manuel' }));
      expect(cmp.step).toBe('data');
      expect(cmp.selectedSource).toBe('manuel');
      expect(cmp.manualForm).toBeTruthy();
    });

    it('un type multi-méthodes s’arrête sur Méthode', () => {
      cmp.selectType(def());     // csv_manuel
      expect(cmp.step).toBe('method');
      expect(cmp.selectedSource).toBeNull();
    });

    it('selectMethod(bulk) ouvre la création en masse sans changer d’étape', () => {
      cmp.selectType(def({ repeatable: true, html_import: true }));
      cmp.selectMethod({ id: 'bulk', icon: '', title: '', desc: '' });
      expect(cmp.bulkModalOpen).toBeTrue();
      expect(cmp.step).toBe('method');
    });

    it('selectMethod(source) ouvre la sous-étape Données', () => {
      cmp.selectType(def());
      cmp.selectMethod({ id: 'manuel', icon: '', title: '', desc: '' });
      expect(cmp.step).toBe('data');
      expect(cmp.selectedSource).toBe('manuel');
    });
  });

  describe('navigation Données ↔ Placement', () => {
    it('goToPlace exige une saisie exploitable', () => {
      cmp.selectType(def({ source: 'manuel' }));   // data + manualForm
      expect(cmp.canContinueFromData).toBeTrue();
      cmp.goToPlace();
      expect(cmp.step).toBe('place');
    });

    it('goToPlace reste bloqué tant qu’aucune image n’est choisie', () => {
      cmp.selectType(def({ source: 'image' }));     // 1 méthode → data (image)
      expect(cmp.selectedSource).toBe('image');
      expect(cmp.canContinueFromData).toBeFalse();
      cmp.goToPlace();
      expect(cmp.step).toBe('data');
    });

    it('backToData revient sans perdre la saisie', () => {
      cmp.selectType(def({ source: 'manuel' }));
      cmp.goToPlace();
      const form = cmp.manualForm;
      cmp.backToData();
      expect(cmp.step).toBe('data');
      expect(cmp.manualForm).toBe(form);
    });

    it('backFromData : vers Méthode si plusieurs, sinon vers le niveau', () => {
      cmp.selectType(def());     // 2 méthodes → method
      cmp.selectMethod({ id: 'manuel', icon: '', title: '', desc: '' });
      cmp.backFromData();
      expect(cmp.step).toBe('method');
      expect(cmp.selectedSource).toBeNull();

      cmp.selectType(def({ source: 'manuel' }));   // 1 méthode → data
      cmp.backFromData();
      expect(cmp.step).toBe('type');               // mono-session
    });

    it('submitCurrent aiguille vers le sous-submit de la source', () => {
      const spies: any = {
        image: spyOn(cmp, 'submitImages'),
        csv: spyOn(cmp, 'confirmImport'),
        manuel: spyOn(cmp, 'submitManual'),
        html: spyOn(cmp, 'submitHtml'),
        compute: spyOn(cmp, 'submitCompute'),
        assemble: spyOn(cmp, 'submitAssemble'),
        'assemble-files': spyOn(cmp, 'submitAssembleFiles'),
      };
      (['image', 'csv', 'manuel', 'html', 'compute', 'assemble', 'assemble-files'] as any[]).forEach(src => {
        cmp.selectedSource = src;
        cmp.submitCurrent();
        expect(spies[src]).toHaveBeenCalled();
      });
    });
  });

  describe('récapitulatif de placement', () => {
    it('methodLabel traduit chaque source', () => {
      expect(cmp.methodLabel('manuel')).toBe('Saisie manuelle');
      expect(cmp.methodLabel('compute')).toBe('Calcul automatique');
      expect(cmp.methodLabel(null)).toBe('—');
    });

    it('placementRecap résume type, rattachement, méthode et contenu', () => {
      cmp.selectedType = def({ code: 'RDL', nom: 'Rattachement' });
      cmp.selectedNiveau = 'ssdgps';
      cmp.selectedSource = 'manuel';
      cmp.wizardRows = [{}, {}];
      expect(cmp.placementRecap.map(r => r.label)).toEqual(['Type', 'Rattachement', 'Méthode', 'Contenu']);
      expect(cmp.placementRecap.find(r => r.label === 'Contenu')?.value).toBe('2 ligne(s)');
    });

    it('placementRecap ajoute le numéro pour un type répétable', () => {
      cmp.selectedType = def({ repeatable: true });
      cmp.selectedNiveau = 'ssdgps';
      cmp.selectedSource = 'manuel';
      cmp.existingPieces = [{ type_piece: 'RDL', numero: 1, is_deleted: false, session: null } as any];
      expect(cmp.placementRecap.some(r => r.label === 'Numéro' && r.value === 'n°2')).toBeTrue();
    });
  });

  describe('import CSV — « Méthode & import » puis « Colonnes » (onglets)', () => {
    const preview = () => ({
      columns: ['Pt', 'Est', 'Nord'],
      preview_rows: [['B12', '100', '200'], ['B13', '101', '201']],
      total_rows: 148,
      champs: [{ name: 'nom_point', label: 'Point' }, { name: 'x', label: 'X' }],
    }) as any;

    it('choisir l’import CSV reste sur « Méthode » (dépôt du fichier inline)', () => {
      cmp.selectType(def());     // csv_manuel → Méthode
      cmp.selectMethod({ id: 'csv', icon: '', title: '', desc: '' });
      expect(cmp.step).toBe('method');
      expect(cmp.selectedSource).toBe('csv');
    });

    it('l’import CSV insère une unique étape « Colonnes » (mapping + aperçu)', () => {
      cmp.selectType(def());
      cmp.selectMethod({ id: 'csv', icon: '', title: '', desc: '' });
      expect(cmp.wizardSteps.map(s => s.key)).toEqual(['type', 'method', 'map', 'place']);
    });

    it('goToMap n’avance qu’une fois le fichier lu, sur l’onglet Mapping', () => {
      cmp.selectedType = def();
      cmp.selectedSource = 'csv';
      cmp.step = 'method';
      cmp.goToMap();
      expect(cmp.step).toBe('method');   // bloqué : pas d'aperçu
      cmp.importPreview = preview();
      cmp.mapTab = 'preview';
      cmp.goToMap();
      expect(cmp.step).toBe('map');
      expect(cmp.mapTab).toBe('mapping');
    });

    it('setMapTab(preview) construit l’aperçu mappé (échantillon reprojeté)', () => {
      cmp.selectedType = def();
      cmp.selectedSource = 'csv';
      cmp.importPreview = preview();
      cmp.currentMapping = { nom_point: 'Pt', x: 'Est' };
      cmp.setMapTab('preview');
      expect(cmp.mapTab).toBe('preview');
      expect(cmp.mappedPreviewChamps.map(c => c.name)).toEqual(['nom_point', 'x']);
      expect(cmp.mappedPreviewRows[0]).toEqual({ nom_point: 'B12', x: '100' });
      expect(cmp.importMappedCount).toBe(2);
      expect(cmp.importTotalChamps).toBe(2);
    });

    it('deselectMethod abandonne le fichier et revient aux cartes', () => {
      cmp.selectedType = def();
      cmp.selectedSource = 'csv';
      cmp.selectedFile = new File(['x'], 'r.csv');
      cmp.importPreview = preview();
      cmp.deselectMethod();
      expect(cmp.step).toBe('method');
      expect(cmp.selectedSource).toBeNull();
      expect(cmp.selectedFile).toBeNull();
      expect(cmp.importPreview).toBeNull();
    });

    it('backFromMap revient au dépôt du fichier en conservant méthode et fichier', () => {
      cmp.selectedSource = 'csv';
      cmp.selectedFile = new File(['x'], 'r.csv');
      cmp.step = 'map';
      cmp.backFromMap();
      expect(cmp.step).toBe('method');
      expect(cmp.selectedSource).toBe('csv');
      expect(cmp.selectedFile).toBeTruthy();
    });

    it('backToData revient à « Colonnes » pour un import CSV (aux Données sinon)', () => {
      cmp.selectedSource = 'csv';
      cmp.backToData();
      expect(cmp.step).toBe('map');
      cmp.selectedSource = 'manuel';
      cmp.backToData();
      expect(cmp.step).toBe('data');
    });

    it('onCsvDrop lit le fichier déposé et arme l’aperçu', () => {
      cmp.selectedType = def();
      (cmp as any).piecesService = { previewImport: () => of(preview()) };
      const file = new File(['x'], 'releve.csv');
      cmp.onCsvDrop({ preventDefault() {}, dataTransfer: { files: [file] } } as any);
      expect(cmp.selectedFile).toBe(file);
      expect(cmp.importPreview).toBeTruthy();
      expect(cmp.dragOver).toBeFalse();
    });

    it('onDragOver / onDragLeave basculent l’état de survol', () => {
      const e: any = { preventDefault() {} };
      cmp.onDragOver(e);
      expect(cmp.dragOver).toBeTrue();
      cmp.onDragLeave(e);
      expect(cmp.dragOver).toBeFalse();
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

    it('selectType (mono) entre dans la phase source', () => {
      cmp.selectType(def());   // csv_manuel → 2 méthodes → sous-étape Méthode
      expect(cmp.selectedNiveau).toBe('ssdgps');
      expect(cmp.step).toBe('method');
    });

    it('selectType (multi SANS session de contexte) va à l’étape scope', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      cmp.defaultSessionId = null;
      cmp.selectType(def());
      expect(cmp.step).toBe('scope');
      expect(cmp.selectedSessionId).toBeNull();
    });

    it('selectType (multi AVEC session de contexte) saute l’étape scope', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      cmp.defaultSessionId = 'sess1';
      cmp.selectType(def());
      expect(cmp.step).toBe('method');          // pas de choix de session
      expect(cmp.selectedNiveau).toBe('session');
      expect(cmp.selectedSessionId).toBe('sess1');
    });

    it('chooseNiveauSession fixe la session et entre dans la phase source', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      cmp.selectedType = def();   // csv_manuel → 2 méthodes
      cmp.chooseNiveauSession('sess2');
      expect(cmp.selectedNiveau).toBe('session');
      expect(cmp.selectedSessionId).toBe('sess2');
      expect(cmp.step).toBe('method');
    });

    it('typeSelected remonte le type choisi puis son abandon', () => {
      const emitted: any[] = [];
      cmp.typeSelected.subscribe(t => emitted.push(t));
      cmp.selectType(def({ code: 'RDC' }));
      cmp.backToType();
      expect(emitted.map(t => t?.code ?? null)).toEqual(['RDC', null]);
    });

    it('backToNiveau saute l’étape session quand elle n’existe pas', () => {
      cmp.ssdgps = { ...cmp.ssdgps, type_ssdgps: 'multi-session' } as any;
      cmp.defaultSessionId = 'sess1';
      cmp.selectType(def());
      cmp.backToNiveau();
      expect(cmp.step).toBe('type');
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
    const li = (name: string, url: string, w: number | null = null, h: number | null = null) =>
      ({ file: new File(['x'], name), url, width: w, height: h }) as any;

    beforeEach(() => {
      cmp.localImages = [li('a.png', 'ua'), li('b.png', 'ub')];
      cmp.selectedImageIndex = 0;
      spyOn(URL, 'revokeObjectURL');
    });

    it('moveLocalImage échange deux images et suit la sélection', () => {
      cmp.selectedImageIndex = 0;
      cmp.moveLocalImage(0, 1);
      expect(cmp.localImages.map(x => x.file.name)).toEqual(['b.png', 'a.png']);
      expect(cmp.selectedImageIndex).toBe(1);   // l'image sélectionnée a suivi
    });

    it('removeLocalImage retire, révoque l’URL et borne la sélection', () => {
      cmp.selectedImageIndex = 1;
      cmp.removeLocalImage(1);
      expect(cmp.localImages.map(x => x.file.name)).toEqual(['a.png']);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('ub');
      expect(cmp.selectedImageIndex).toBe(0);
    });

    it('selectLocalImage + selectedLocalImage pointent la bonne image', () => {
      cmp.selectLocalImage(1);
      expect(cmp.selectedLocalImage?.file.name).toBe('b.png');
    });

    it('isPreviewable faux pour un TIFF', () => {
      expect(cmp.isPreviewable(new File(['x'], 'p.tiff'))).toBeFalse();
      expect(cmp.isPreviewable(new File(['x'], 'p.png'))).toBeTrue();
    });

    it('imageOrientation / imagesOrientation d’après les dimensions', () => {
      cmp.localImages = [li('p.png', 'u1', 1000, 1500), li('q.png', 'u2', 800, 1200)];
      expect(cmp.imageOrientation(cmp.localImages[0])).toBe('portrait');
      expect(cmp.imagesOrientation).toBe('portrait');
      cmp.localImages = [li('l.png', 'u3', 1600, 900)];
      expect(cmp.imageOrientation(cmp.localImages[0])).toBe('paysage');
      expect(cmp.imagesOrientation).toBe('paysage');
      cmp.localImages = [li('t.tiff', 'u4')];   // dimensions inconnues
      expect(cmp.imagesOrientation).toBeNull();
    });

    it('imageRecommendation s’adapte à l’orientation dominante', () => {
      cmp.localImages = [];
      expect(cmp.imageRecommendation.orient).toBe('portrait ou paysage');
      cmp.localImages = [li('l.png', 'u', 1600, 900)];
      expect(cmp.imageRecommendation.orient).toBe('paysage');
      expect(cmp.imageRecommendation.ratio).toBe('4:3');
    });

    it('imageFormat / humanSize', () => {
      expect(cmp.imageFormat(li('Photo.JPG', 'u'))).toBe('JPG');
      expect(cmp.humanSize(2 * 1024 * 1024)).toBe('2.0 Mo');
      expect(cmp.humanSize(0)).toBe('—');
    });

    it('la visionneuse plein écran ne s’ouvre que pour une image prévisualisable', () => {
      cmp.localImages = [li('p.png', 'u1', 10, 10)];
      cmp.selectedImageIndex = 0;
      cmp.openImageLightbox();
      expect(cmp.imageLightboxOpen).toBeTrue();
      cmp.closeImageLightbox();
      expect(cmp.imageLightboxOpen).toBeFalse();
      cmp.localImages = [li('t.tiff', 'u2')];
      cmp.openImageLightbox();
      expect(cmp.imageLightboxOpen).toBeFalse();   // TIFF : pas d'aperçu
    });

    it('ingestImages rejette les fichiers > 2 Mo et les formats non gérés', () => {
      const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png');
      const ok = new File([new Uint8Array(100)], 'ok.png');
      const bad = new File([new Uint8Array(100)], 'doc.pdf');
      cmp.localImages = [];
      (cmp as any).ingestImages([big, ok, bad]);
      expect(cmp.localImages.map(x => x.file.name)).toEqual(['ok.png']);
      expect(toast.error).toHaveBeenCalled();
    });

    it('ingestImages renseigne compression et date de modification dès la sélection', () => {
      const f = new File([new Uint8Array(10)], 'plan.png', { lastModified: Date.UTC(2026, 2, 15, 9, 0, 0) });
      cmp.localImages = [];
      (cmp as any).ingestImages([f]);
      const li = cmp.localImages[0];
      expect(li.compression).toBe('Deflate/ZIP (sans perte)');
      expect(li.dateModification.getTime()).toBe(f.lastModified);
      // Renseignés après décodage / lecture EXIF — vides à cet instant.
      expect(li.modeCouleur).toBe('');
      expect(li.dateCreation).toBeNull();
    });

    it('setImageViewMode bascule miniatures ↔ liste', () => {
      expect(cmp.imageViewMode).toBe('grid');
      cmp.setImageViewMode('list');
      expect(cmp.imageViewMode).toBe('list');
      cmp.setImageViewMode('grid');
      expect(cmp.imageViewMode).toBe('grid');
    });

    it('formatImageDate suit le format daté de l’app et « — » si absente', () => {
      expect(cmp.formatImageDate(null)).toBe('—');
      expect(cmp.formatImageDate(new Date(2026, 2, 15, 14, 30, 5))).toBe('15/03/2026 14:30:05');
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

describe('PieceAddWizardComponent — type imposé par l’hôte (assistant SDGPS)', () => {
  let cmp: PieceAddWizardComponent;
  const stubs = () => ({ get: () => of({}) });

  beforeEach(() => {
    cmp = new PieceAddWizardComponent({} as any, jasmine.createSpyObj('ToastService', ['success', 'error']) as any,
      new FormBuilder(), stubs() as any, stubs() as any);
    cmp.ssdgps = { id: 's1', type_ssdgps: 'mono-session', nature_ssdgps: 'PDC/GPS' } as any;
    cmp.catalog = [{ code: 'LPA', nom: 'Liste', source: 'manuel', natures: 'toutes', champs: [] } as any];
    cmp.existingPieces = [];
  });

  it('presetTypeCode saute l’étape « Type »', () => {
    const emitted = jasmine.createSpy('typeSelected');
    cmp.typeSelected.subscribe(emitted);
    cmp.presetTypeCode = 'LPA';
    cmp.ngOnInit();
    expect(cmp.selectedType?.code).toBe('LPA');
    expect(cmp.step).not.toBe('type');
    expect(emitted).toHaveBeenCalled();
  });

  it('un code inconnu laisse le parcours sur l’étape « Type »', () => {
    cmp.presetTypeCode = 'XXX';
    cmp.ngOnInit();
    expect(cmp.step).toBe('type');
  });

  it('revenir au type rend la main à l’hôte quand le type est imposé', () => {
    const cancelled = jasmine.createSpy('cancelled');
    cmp.cancelled.subscribe(cancelled);
    cmp.presetTypeCode = 'LPA';
    cmp.ngOnInit();
    cmp.backToType();
    expect(cancelled).toHaveBeenCalled();
  });
});

describe('PieceAddWizardComponent — PDF d’images', () => {
  let cmp: PieceAddWizardComponent;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    cmp = new PieceAddWizardComponent({} as any, toast, new FormBuilder(), {} as any, {} as any);
  });

  it('les PDF passent un par un par l’éditeur, les images entrent directement', () => {
    const a = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    const b = new File(['%PDF'], 'b.pdf', { type: 'application/pdf' });
    const png = new File(['x'], 'img.png', { type: 'image/png' });
    cmp.onImagesSelected({ target: { files: [a, png, b], value: 'x' } } as any);
    expect(cmp.pdfEditing).toBe(a);
    expect(cmp.localImages.map(li => li.file.name)).toEqual(['img.png']);

    const page = new File(['y'], 'a-p01.jpg', { type: 'image/jpeg' });
    cmp.onPdfPages([{ file: page, pointRef: '' }]);
    expect(cmp.localImages.map(li => li.file.name)).toEqual(['img.png', 'a-p01.jpg']);
    expect(cmp.pdfEditing).toBe(b);                            // PDF suivant
    cmp.onPdfCancelled();
    expect(cmp.pdfEditing).toBeNull();
  });
});
