import { of, throwError } from 'rxjs';
import { SdgpsAssistantComponent } from './sdgps-assistant.component';

describe('SdgpsAssistantComponent (logique)', () => {
  let cmp: SdgpsAssistantComponent;
  let projects: jasmine.SpyObj<any>;
  let modeles: jasmine.SpyObj<any>;
  let pieces: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;
  let router: jasmine.SpyObj<any>;

  const plan = (over: any = {}) => ({
    ssdgps: 's1', modele: 'm1', modele_nom: 'PDC', hors_modele: [], total: 3, importees: 1, validees: 0,
    a_valider: 1, pret: false,
    items: [
      { type_piece: 'LPA', numero: null, nom: 'LPA', obligatoire: true, source: 'csv_manuel', etat: 'brouillon', pieces: [{ id: 'p1', statut: 'brouillon', session_numero: null }] },
      { type_piece: 'RDN', numero: 1, nom: 'RDN 1', obligatoire: true, source: 'csv_manuel', etat: 'a_importer', pieces: [] },
      { type_piece: 'RDC', numero: null, nom: 'RDC', obligatoire: true, source: 'image', etat: 'a_importer', pieces: [] },
    ],
    ...over,
  });

  beforeEach(() => {
    projects = jasmine.createSpyObj('ProjectsService', ['getProprietes', 'getAffaires', 'getSessions', 'getSsdgpsById', 'transitionSsdgps']);
    modeles = jasmine.createSpyObj('ModelesSsdgpsService', ['list', 'createDossier', 'getPlan', 'validatePieces', 'duplicate', 'applyModele', 'fromSsdgps']);
    pieces = jasmine.createSpyObj('PiecesService', ['listBySsdgps', 'checkReportCoherence', 'startReport']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.url = '/projets/assistant';
    const auth = jasmine.createSpyObj('AuthService', ['isPlatformAdmin']);
    auth.isPlatformAdmin.and.returnValue(false);
    projects.getProprietes.and.returnValue(of([]));
    projects.getAffaires.and.returnValue(of([]));
    cmp = new SdgpsAssistantComponent(
      projects, modeles, pieces, {} as any, {} as any, {} as any, toast, router, {} as any,
      jasmine.createSpyObj('BreadcrumbService', ['set', 'clear']), auth,
    );
    cmp.currentOrgId = 'org1';
  });

  // ---------------------------------------------------------------- Validation des étapes
  describe('étapes', () => {
    it('projet existant : il faut en choisir un', () => {
      cmp.projetMode = 'existant';
      expect(cmp.stepValid('projet')).toBeFalse();
      cmp.selectProjet('p1');
      expect(cmp.stepValid('projet')).toBeTrue();
      expect(projects.getProprietes).toHaveBeenCalledWith('p1');
    });

    it('nouveau projet : nom + code, et organisation si l’utilisateur n’en a pas', () => {
      cmp.projetMode = 'nouveau';
      cmp.projetNew.nom_projet = 'P';
      expect(cmp.stepValid('projet')).toBeFalse();
      cmp.projetNew.code_projet = 'P-1';
      expect(cmp.stepValid('projet')).toBeTrue();
      cmp.currentOrgId = null;
      expect(cmp.stepValid('projet')).toBeFalse();
      cmp.projetNew.organization = 'o2';
      expect(cmp.stepValid('projet')).toBeTrue();
    });

    it('propriété : formats titre / réquisition et organismes requis', () => {
      Object.assign(cmp.proprieteNew, { nom_propriete: 'X', id_titre: 'TF12', organisme_niveau1: 'n1', organisme_niveau2: 'n2' });
      expect(cmp.proprieteErrors()).toContain('titre');
      cmp.proprieteNew.id_titre = 'T12345/A';
      expect(cmp.proprieteErrors()).toEqual([]);
      cmp.proprieteNew.id_titre = '';
      expect(cmp.proprieteErrors()).toContain('identifiant');
      cmp.proprieteNew.id_requisition = 'R19000/55';
      expect(cmp.stepValid('propriete')).toBeTrue();
    });

    it('affaire : la date n’est requise que hors IFE/IFR, et la nature suit la procédure', () => {
      cmp.affaireNew.nature_procedure_affaire = 'IFF';
      cmp.onProcedureChange();
      expect(cmp.natureAffaireOptions.map(o => o.value)).toEqual(['BI', 'BC']);
      cmp.affaireNew.nature_affaire = 'BI';
      expect(cmp.affaireErrors()).toEqual(['date']);
      cmp.affaireNew.nature_procedure_affaire = 'IFE';
      cmp.onProcedureChange();
      expect(cmp.affaireNew.nature_affaire).toBe('IFE');     // seule nature possible
      expect(cmp.dateBornageRequise).toBeFalse();
      expect(cmp.affaireErrors()).toEqual([]);
    });

    it('affaire : un numéro déjà pris dans la propriété est refusé', () => {
      cmp.affaires = [{ id: 'a1', numero_sd_affaire: 1 } as any];
      Object.assign(cmp.affaireNew, { numero_sd_affaire: 1, nature_procedure_affaire: 'IFE', nature_affaire: 'IFE' });
      expect(cmp.affaireErrors()).toContain('numero_pris');
    });

    it('dossier : un modèle est obligatoire, et 1 à 50 sessions en multi-session', () => {
      expect(cmp.stepValid('dossier')).toBeFalse();
      cmp.modeleId = 'm1';
      expect(cmp.stepValid('dossier')).toBeTrue();
      cmp.typeSsdgps = 'multi-session'; cmp.nbSessions = 0;
      expect(cmp.stepValid('dossier')).toBeFalse();
    });

    it('canGoTo : pas d’étape future tant que les précédentes sont invalides ; après création, seules pièces et rapport', () => {
      cmp.projetMode = 'existant';
      expect(cmp.canGoTo('propriete')).toBeFalse();
      cmp.selectProjet('p1');
      expect(cmp.canGoTo('propriete')).toBeTrue();
      expect(cmp.canGoTo('pieces')).toBeFalse();
      cmp.ssdgps = { id: 's1' } as any;
      expect(cmp.canGoTo('projet')).toBeFalse();
      expect(cmp.canGoTo('pieces')).toBeTrue();
      expect(cmp.canGoTo('rapport')).toBeTrue();
    });

    it('changer de projet réinitialise propriété et affaire', () => {
      cmp.proprieteId = 'pr1'; cmp.affaireId = 'a1';
      cmp.selectProjet('p2');
      expect(cmp.proprieteId).toBeNull();
      expect(cmp.affaireId).toBeNull();
    });

    it('suggestCode propose un code à partir du nom', () => {
      cmp.projetNew.nom_projet = 'Élancourt Nord';
      cmp.suggestCode();
      expect(cmp.projetNew.code_projet).toMatch(/^ELAN-\d{8}-[A-Z0-9]{3}$/);
    });
  });

  // ---------------------------------------------------------------- Modèles
  describe('modèles', () => {
    it('loadModeles sélectionne par défaut le modèle de l’application', () => {
      modeles.list.and.returnValue(of([
        { id: 'perso', portee: 'personnel', type_ssdgps: 'mono-session' },
        { id: 'sys', portee: 'systeme', type_ssdgps: 'multi-session' },
      ]));
      cmp.loadModeles();
      expect(modeles.list).toHaveBeenCalledWith('PDC/GPS');
      expect(cmp.modeleId).toBe('sys');
      expect(cmp.typeSsdgps).toBe('multi-session');   // le type suit le modèle choisi
    });

    it('loadModeles garde le modèle demandé', () => {
      modeles.list.and.returnValue(of([{ id: 'sys', portee: 'systeme' }, { id: 'perso', portee: 'personnel' }]));
      cmp.loadModeles('perso');
      expect(cmp.modeleId).toBe('perso');
    });

    it('setNature recharge les modèles de la nouvelle nature', () => {
      modeles.list.and.returnValue(of([]));
      cmp.setNature('DLC/GPS');
      expect(modeles.list).toHaveBeenCalledWith('DLC/GPS');
    });
  });

  // ---------------------------------------------------------------- Création
  describe('création du dossier', () => {
    beforeEach(() => {
      cmp.projetMode = 'existant'; cmp.projetId = 'p1';
      cmp.proprieteMode = 'nouveau';
      Object.assign(cmp.proprieteNew, { nom_propriete: ' X ', id_titre: 'T1/A', organisme_niveau1: 'n1', organisme_niveau2: 'n2' });
      cmp.affaireMode = 'existant'; cmp.affaireId = 'a1';
      cmp.modeleId = 'm1';
    });

    it('buildPayload mélange niveaux existants et nouveaux', () => {
      const p: any = cmp.buildPayload();
      expect(p.projet).toEqual({ id: 'p1' });
      expect(p.propriete.nouveau.nom_propriete).toBe('X');
      expect(p.affaire).toEqual({ id: 'a1' });
      expect(p.ssdgps).toEqual({ nature_ssdgps: 'PDC/GPS', type_ssdgps: 'mono-session' });
      expect(p.modele).toBe('m1');
      expect(p.nb_sessions).toBeUndefined();
    });

    it('buildPayload : organisation explicite seulement sans organisation courante ; nb_sessions en multi', () => {
      cmp.projetMode = 'nouveau';
      Object.assign(cmp.projetNew, { nom_projet: 'P', code_projet: 'C', organization: 'o2' });
      expect((cmp.buildPayload() as any).projet.nouveau.organization).toBeUndefined();
      cmp.currentOrgId = null;
      expect((cmp.buildPayload() as any).projet.nouveau.organization).toBe('o2');
      cmp.typeSsdgps = 'multi-session'; cmp.nbSessions = 3;
      expect(cmp.buildPayload().nb_sessions).toBe(3);
    });

    it('createDossier passe à l’étape Pièces et mémorise la chaîne créée', () => {
      modeles.createDossier.and.returnValue(of({
        ssdgps: { id: 's1', numero_ssdgps: 1, nature_ssdgps: 'PDC/GPS' }, projet: 'p1', propriete: 'pr1', affaire: 'a1',
        crees: ['propriete', 'ssdgps'], plan: plan(),
      }));
      modeles.getPlan.and.returnValue(of(plan()));
      projects.getSessions.and.returnValue(of([]));
      projects.getSsdgpsById.and.returnValue(of({ id: 's1' }));
      pieces.listBySsdgps.and.returnValue(of([]));
      cmp.step = 'dossier';
      cmp.createDossier();
      expect(cmp.step).toBe('pieces');
      expect(cmp.created).toBeTrue();
      expect(cmp.createdProprieteId).toBe('pr1');
      expect(cmp.activeKey).toBe('RDN#1');                  // première pièce à importer
      expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
        queryParams: { ssdgps: 's1', projet: 'p1' } }));
    });

    it('une erreur serveur ramène à l’étape fautive', () => {
      modeles.createDossier.and.returnValue(throwError(() => ({ error: { affaire: { date_bornage: ['Requise.'] } } })));
      cmp.step = 'dossier';
      cmp.createDossier();
      expect(cmp.step).toBe('affaire');
      expect(cmp.stepError.affaire).toContain('Requise.');
      expect(cmp.creating).toBeFalse();
    });

    it('une erreur de modèle reste sur l’étape Dossier', () => {
      cmp.step = 'dossier';
      cmp.handleCreateError({ modele: 'Modèle introuvable.' });
      expect(cmp.step).toBe('dossier');
      expect(cmp.stepError.dossier).toBe('Modèle introuvable.');
    });
  });

  // ---------------------------------------------------------------- Pièces & rapport
  describe('liste de contrôle', () => {
    beforeEach(() => {
      cmp.ssdgps = { id: 's1', transitions: ['soumettre'] } as any;
      cmp.plan = plan() as any;
    });

    it('progressions et sélection de la pièce suivante', () => {
      expect(cmp.progressImport).toBe(33);
      cmp.selectNextToImport();
      expect(cmp.activeItem?.type_piece).toBe('RDN');
      expect(cmp.showWizard).toBeTrue();
    });

    it('une pièce déjà importée n’ouvre pas l’import, sauf autre occurrence demandée', () => {
      cmp.selectItem(cmp.plan!.items[0]);
      expect(cmp.showWizard).toBeFalse();
      cmp.addingAnother = true;
      expect(cmp.showWizard).toBeTrue();
    });

    it('un dossier verrouillé n’ouvre jamais l’import', () => {
      cmp.ssdgps = { id: 's1', verrouille: true } as any;
      cmp.selectNextToImport();
      expect(cmp.showWizard).toBeFalse();
    });

    it('validate() met à jour le plan et remonte les échecs', () => {
      const after = plan({ validees: 1, a_valider: 0 });
      modeles.validatePieces.and.returnValue(of({ validees: 1, echecs: [{ type_piece: 'PPA', numero: null, message: 'photo' }], plan: after }));
      pieces.listBySsdgps.and.returnValue(of([]));
      cmp.validate();
      expect(cmp.plan!.validees).toBe(1);
      expect(cmp.validationEchecs.length).toBe(1);
      expect(toast.warning).toHaveBeenCalled();
    });

    it('validateItem ne transmet que les occurrences non validées', () => {
      modeles.validatePieces.and.returnValue(of({ validees: 1, echecs: [], plan: plan() }));
      pieces.listBySsdgps.and.returnValue(of([]));
      cmp.validateItem(cmp.plan!.items[0]);
      expect(modeles.validatePieces).toHaveBeenCalledWith('s1', ['p1']);
    });

    it('canSubmit exige un dossier prêt et la transition ouverte', () => {
      expect(cmp.canSubmit).toBeFalse();
      cmp.plan = plan({ pret: true }) as any;
      expect(cmp.canSubmit).toBeTrue();
      cmp.ssdgps = { id: 's1', transitions: [] } as any;
      expect(cmp.canSubmit).toBeFalse();
    });

    it('goTo(rapport) lance le contrôle de cohérence ; un échec n’affiche rien', () => {
      pieces.checkReportCoherence.and.returnValue(throwError(() => ({})));
      cmp.goTo('rapport');
      expect(cmp.step).toBe('rapport');
      expect(cmp.coherence).toBeNull();
      expect(cmp.coherenceLoading).toBeFalse();
    });

    it('generate() démarre la génération en tâche de fond', () => {
      pieces.startReport.and.returnValue(of({ id: 'j1', statut: 'en_cours', progression: 5 }));
      cmp.generate();
      expect(pieces.startReport).toHaveBeenCalledWith('s1');
      expect(cmp.generating).toBeTrue();
      cmp.ngOnDestroy();                                     // coupe le sondage
    });

    it('openPiece navigue vers la pièce dans son projet', () => {
      cmp.createdProjetId = 'p1';
      cmp.openPiece('x9');
      expect(router.navigate).toHaveBeenCalledWith(['/projets', 'p1', 'pieces', 's1', 'piece', 'x9']);
    });
  });
});

describe('SdgpsAssistantComponent — barre d’actions', () => {
  it('footerHint dit ce qui manque, puis que l’étape est complète', () => {
    const auth = jasmine.createSpyObj('AuthService', ['isPlatformAdmin']);
    const cmp = new SdgpsAssistantComponent({} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, { url: '/projets/assistant' } as any, {} as any, jasmine.createSpyObj('B', ['set', 'clear']), auth);
    cmp.projetMode = 'existant';
    expect(cmp.footerHint).toEqual({ text: 'Choisissez un projet.', ok: false });
    cmp.projetId = 'p1';
    expect(cmp.footerHint?.ok).toBeTrue();
    cmp.step = 'dossier';
    expect(cmp.footerHint?.text).toContain('modèle');
    cmp.ssdgps = { id: 's1' } as any;
    cmp.step = 'pieces';
    cmp.plan = { total: 4, validees: 1, pret: false } as any;
    expect(cmp.footerHint).toEqual({ text: '1/4 pièces validées.', ok: false });
  });
});
