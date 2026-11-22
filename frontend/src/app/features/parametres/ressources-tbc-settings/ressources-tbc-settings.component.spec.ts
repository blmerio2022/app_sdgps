import { of, throwError } from 'rxjs';
import { RessourcesTbcSettingsComponent } from './ressources-tbc-settings.component';

const R = (over: any = {}): any => ({
  id: 'r1', type_ressource: 'etude_modele', libelle: 'Étude modèle TBC', nom_fichier: 'modele.vct', taille: 1024,
  description: 'v1', organisation: { id: 'o1', nom: 'Cadastre A' }, source: 'organisation',
  created_at: '', updated_at: '', created_by_email: null, updated_by_email: null, peut_gerer: true, ...over,
});

describe('RessourcesTbcSettingsComponent', () => {
  let svc: any;
  let toast: any;
  let cmp: RessourcesTbcSettingsComponent;
  const gestion = {
    niveaux: [{ organisation: null, ressources: { etude_modele: R({ id: 'app', organisation: null, source: 'application' }), ruban: null } },
              { organisation: { id: 'o1', nom: 'Cadastre A' }, ressources: { etude_modele: R(), ruban: null } }],
    extensions: { etude_modele: ['.vct', '.vce'], ruban: ['.bin'] }, taille_max: 1000,
  };

  beforeEach(() => {
    svc = jasmine.createSpyObj('RessourcesTbcService',
      ['disponibles', 'gestion', 'deposer', 'retirer', 'modifierDescription', 'telecharger']);
    svc.disponibles.and.returnValue(of({ peut_gerer: true, ressources: [
      { type_ressource: 'etude_modele', libelle: 'Étude modèle TBC', conseil: 'c', ressource: R() },
      { type_ressource: 'ruban', libelle: 'Ruban', conseil: 'c', ressource: null }] }));
    svc.gestion.and.returnValue(of(gestion));
    svc.deposer.and.returnValue(of(R()));
    svc.retirer.and.returnValue(of(undefined));
    svc.modifierDescription.and.returnValue(of(R({ description: 'v2' })));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    cmp = new RessourcesTbcSettingsComponent(svc, toast);
    cmp.ngOnInit();
  });

  it('charge les ressources et, pour un administrateur, les niveaux gérés', () => {
    expect(cmp.disponibles.length).toBe(2);
    expect(cmp.gestion?.niveaux.length).toBe(2);
    expect(cmp.descriptions['r1']).toBe('v1');
    expect(cmp.provenance(R())).toBe('Fournie par Cadastre A');
    expect(cmp.provenance(R({ source: 'application', organisation: null }))).toContain("l'application");
  });

  it("un opérateur ne charge pas la gestion", () => {
    svc.gestion.calls.reset();
    svc.disponibles.and.returnValue(of({ peut_gerer: false, ressources: [] }));
    cmp.charger();
    expect(svc.gestion).not.toHaveBeenCalled();
  });

  function champ(nom: string, taille = 10): any {
    const f = new File(['x'.repeat(taille)], nom);
    return { files: [f], value: 'x' };
  }

  it("dépose au niveau de l'organisation (description reprise), refuse un format ou une taille hors limites", () => {
    const niveau = gestion.niveaux[1] as any;
    cmp.deposer(niveau, 'etude_modele', champ('nouveau.vce'));
    expect(svc.deposer).toHaveBeenCalledWith('etude_modele', jasmine.any(File), 'o1', 'v1');
    expect(toast.success).toHaveBeenCalledWith('Fichier remplacé', 'nouveau.vce');
    svc.deposer.calls.reset();
    cmp.deposer(gestion.niveaux[0] as any, 'ruban', champ('ruban.exe'));
    cmp.deposer(gestion.niveaux[0] as any, 'ruban', champ('gros.bin', 2000));
    expect(svc.deposer).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('erreur du serveur affichée', () => {
    svc.deposer.and.returnValue(throwError(() => ({ error: { fichier: ['Format non accepté.'] } })));
    cmp.deposer(gestion.niveaux[0] as any, 'ruban', champ('a.bin'));
    expect(toast.error).toHaveBeenCalledWith('Dépôt impossible', 'Format non accepté.');
  });

  it('retrait confirmé, description enregistrée', () => {
    spyOn(window, 'confirm').and.returnValues(false, true);
    cmp.retirer(gestion.niveaux[1] as any, 'etude_modele');
    expect(svc.retirer).not.toHaveBeenCalled();
    cmp.retirer(gestion.niveaux[1] as any, 'etude_modele');
    expect(svc.retirer).toHaveBeenCalledWith('r1');
    const r = R();
    cmp.descriptions['r1'] = 'v2';
    expect(cmp.descriptionModifiee(r)).toBeTrue();
    cmp.enregistrerDescription(r);
    expect(svc.modifierDescription).toHaveBeenCalledWith('r1', 'v2');
  });

  it('télécharge le fichier sous son nom', () => {
    svc.telecharger.and.returnValue(of({ body: new Blob(['x']) }));
    const clic = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.telecharger(R());
    expect(clic).toHaveBeenCalled();
    svc.telecharger.and.returnValue(throwError(() => ({ error: { detail: 'Ressource introuvable.' } })));
    cmp.telecharger(R());
    expect(toast.error).toHaveBeenCalledWith('Téléchargement impossible', 'Ressource introuvable.');
  });
});
