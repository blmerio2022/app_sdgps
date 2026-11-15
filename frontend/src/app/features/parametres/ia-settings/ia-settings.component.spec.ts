import { of, throwError } from 'rxjs';
import { IaSettingsComponent } from './ia-settings.component';

function config(modifiable = true, saisie: any = {}): any {
  return {
    modifiable, source: 'environnement',
    saisie: { actif: null, fournisseur: '', base_url: '', protocole: '', modele: '', modeles_secours: [],
              delai: null, cle_enregistree: false, cle_indice: '', cle_illisible: false, ...saisie },
    effectif: { disponible: true, actif: true, fournisseur: 'omniroute', fournisseur_libelle: 'OmniRoute',
                protocole: 'anthropic', adresse: 'http://localhost:20128', modele: 'Free-Combo',
                modeles_essai: ['Free-Combo'], cle_presente: true, cle_indice: 'ab12', cle_origine: 'environnement', delai: 90 },
    catalogue: [{ cle: 'openrouter', libelle: 'OpenRouter', protocole: 'openai', base_url: 'https://openrouter.ai/api/v1',
                  modele: '', gratuit: 'Modèles :free', obtenir_cle: 'https://openrouter.ai/keys' }],
    modifie_le: null, modifie_par: null,
  };
}

describe('IaSettingsComponent (Paramètres › Intelligence artificielle)', () => {
  let ia: any;
  let cmp: IaSettingsComponent;

  beforeEach(() => {
    ia = {
      configuration: jasmine.createSpy('configuration').and.returnValue(of(config())),
      enregistrerConfiguration: jasmine.createSpy('enregistrer').and.callFake((s: any) =>
        of(config(true, { fournisseur: s.fournisseur, modele: s.modele, modeles_secours: s.modeles_secours,
                          cle_enregistree: !!s.cle, cle_indice: s.cle ? s.cle.slice(-4) : '' }))),
      reinitialiserConfiguration: jasmine.createSpy('reinit').and.returnValue(of(config())),
      testerConfiguration: jasmine.createSpy('tester').and.returnValue(of({ ok: true, modeles_accessibles: 3,
        essais: [{ modele: 'm:free', ok: true, duree: 1.2 }] })),
      modeles: jasmine.createSpy('modeles').and.returnValue(of({ modeles: ['a:free', 'b', 'c:free'] })),
      preferences: jasmine.createSpy('prefs').and.returnValue(of({ modele_assistant: '', modele_par_defaut: 'Free-Combo' })),
      enregistrerPreferences: jasmine.createSpy('prefsPut').and.returnValue(of({ modele_assistant: 'auto/best-chat', modele_par_defaut: 'Free-Combo' })),
    };
    cmp = new IaSettingsComponent(ia);
    cmp.ngOnInit();
  });

  it('charge l’état effectif et la préférence', () => {
    expect(cmp.config?.effectif.modele).toBe('Free-Combo');
    expect(cmp.modeleParDefaut).toBe('Free-Combo');
  });

  it('enregistre fournisseur, modèles et clé (jamais relue ensuite)', () => {
    cmp.choisirFournisseur('openrouter');
    cmp.modele = 'm:free';
    cmp.ajouterSecours('s1:free');
    cmp.ajouterSecours('s1:free');                                   // pas de doublon
    cmp.cle = 'sk-or-v1-abcd1234';
    cmp.enregistrer();
    const envoye = ia.enregistrerConfiguration.calls.mostRecent().args[0];
    expect(envoye).toEqual(jasmine.objectContaining({ fournisseur: 'openrouter', modele: 'm:free',
                                                      modeles_secours: ['s1:free'], cle: 'sk-or-v1-abcd1234' }));
    expect(cmp.cle).toBe('');                                        // champ vidé après enregistrement
    expect(cmp.config?.saisie.cle_indice).toBe('1234');
    expect(cmp.succes).toContain('enregistrée');
  });

  it('changer de fournisseur repart du modèle suggéré', () => {
    cmp.modele = 'ancien';
    cmp.secours = ['x'];
    cmp.choisirFournisseur('openrouter');
    expect([cmp.modele, cmp.secours.length]).toEqual(['', 0]);
  });

  it('effacer la clé', () => {
    cmp.effacerCle = true;
    cmp.cle = 'ignorée';
    cmp.enregistrer();
    const envoye = ia.enregistrerConfiguration.calls.mostRecent().args[0];
    expect(envoye.effacer_cle).toBeTrue();
    expect(envoye.cle).toBeUndefined();
  });

  it('erreurs de validation affichées', () => {
    ia.enregistrerConfiguration.and.returnValue(throwError(() => ({ status: 400, error: { base_url: 'Adresse invalide.' } })));
    cmp.enregistrer();
    expect(cmp.erreur).toBe('Adresse invalide.');
  });

  it('ordre des modèles de secours', () => {
    cmp.secours = ['a', 'b', 'c'];
    cmp.monterSecours(2);
    expect(cmp.secours).toEqual(['a', 'c', 'b']);
    cmp.retirerSecours(0);
    expect(cmp.secours).toEqual(['c', 'b']);
  });

  it('test de connexion et liste des modèles filtrée', () => {
    cmp.tester();
    expect(cmp.test?.ok).toBeTrue();
    cmp.chargerModeles();
    cmp.filtreModeles = ':free';
    expect(cmp.modelesFiltres).toEqual(['a:free', 'c:free']);
  });

  it('retour à la configuration du serveur (avec confirmation)', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.reinitialiser();
    expect(ia.reinitialiserConfiguration).toHaveBeenCalled();
  });

  it('préférence personnelle du modèle de l’assistant', () => {
    cmp.modelePrefere = ' auto/best-chat ';
    cmp.enregistrerPreference();
    expect(ia.enregistrerPreferences).toHaveBeenCalledWith('auto/best-chat');
    expect(cmp.prefEnregistree).toBeTrue();
  });
});
