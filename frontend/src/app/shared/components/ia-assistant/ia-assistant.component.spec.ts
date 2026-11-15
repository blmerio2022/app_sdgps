import { of, throwError } from 'rxjs';
import { CLE_CONVERSATION, IaAssistantComponent } from './ia-assistant.component';

describe('IaAssistantComponent (n°5)', () => {
  let ia: any;
  let router: any;
  let cmp: IaAssistantComponent;

  beforeEach(() => {
    sessionStorage.removeItem(CLE_CONVERSATION);
    ia = {
      disponible$: of(true),
      assistant: jasmine.createSpy('assistant').and.returnValue(of({
        reponse: 'Vous avez 2 dossiers :\n- SDGPS n°4\n- SDGPS n°5',
        actions: [{ action: 'generer_rapport', libelle: 'Générer le rapport', route: 'projets/p/pieces/s?rapport=1' }],
        outils: ['chercher_dossiers'],
      })),
    };
    router = { url: '/projets', navigateByUrl: jasmine.createSpy('navigateByUrl') };
    cmp = new IaAssistantComponent(ia, router);
    cmp.ngOnInit();
  });

  afterEach(() => sessionStorage.removeItem(CLE_CONVERSATION));

  it('masqué si l’IA n’est pas activée', () => {
    ia.disponible$ = of(false);
    const autre = new IaAssistantComponent(ia, router);
    autre.ngOnInit();
    expect(autre.disponible).toBeFalse();
  });

  it('envoie la question avec l’historique et affiche réponse et boutons', () => {
    cmp.brouillon = '  Mes dossiers ?  ';
    cmp.envoyer();
    expect(ia.assistant).toHaveBeenCalledWith([{ role: 'user', content: 'Mes dossiers ?' }]);
    expect(cmp.brouillon).toBe('');
    expect(cmp.messages.length).toBe(2);
    expect(cmp.messages[1].actions?.length).toBe(1);
    expect(cmp.enCours).toBeFalse();
  });

  it('une suggestion s’envoie d’un clic ; un message vide, jamais', () => {
    cmp.envoyer('   ');
    expect(ia.assistant).not.toHaveBeenCalled();
    cmp.envoyer(cmp.suggestions[0]);
    expect(ia.assistant).toHaveBeenCalled();
  });

  it('Entrée envoie, Maj+Entrée va à la ligne', () => {
    cmp.brouillon = 'Bonjour';
    const majEntree = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
    cmp.onToucheSaisie(majEntree);
    expect(ia.assistant).not.toHaveBeenCalled();
    cmp.onToucheSaisie(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(ia.assistant).toHaveBeenCalled();
  });

  it('la conversation survit au rechargement de la page (onglet), puis s’efface', () => {
    cmp.envoyer('Bonjour');
    const relu = new IaAssistantComponent(ia, router);
    relu.ngOnInit();
    expect(relu.messages.length).toBe(2);
    relu.nouvelleConversation();
    expect(JSON.parse(sessionStorage.getItem(CLE_CONVERSATION)!)).toEqual([]);
  });

  it('une erreur se réessaie sans retaper la question', () => {
    ia.assistant.and.returnValue(throwError(() => ({ status: 502, error: { detail: 'Service saturé' } })));
    cmp.envoyer('Bonjour');
    expect(cmp.erreur).toBe('Service saturé');
    expect(cmp.derniereSansReponse).toBeTrue();
    ia.assistant.and.returnValue(of({ reponse: 'Bonjour !', actions: [], outils: [] }));
    cmp.reessayer();
    expect(cmp.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(cmp.erreur).toBe('');
  });

  it('un bouton d’action navigue dans le même espace (opérateur ou admin)', () => {
    const action = { action: 'gerer_cachets', libelle: 'x', route: 'parametres/cachets-signatures' };
    cmp.ouvert = true;
    cmp.agir(action);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/parametres/cachets-signatures');
    expect(cmp.ouvert).toBeFalse();
    router.url = '/admin/projets';
    cmp.agir(action);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/parametres/cachets-signatures');
  });

  it('le gras Markdown est rendu, les titres nettoyés, sans HTML interprété', () => {
    expect(cmp.segments('Allez dans **Paramètres** puis **Cachets**.')).toEqual([
      { texte: 'Allez dans ', gras: false }, { texte: 'Paramètres', gras: true },
      { texte: ' puis ', gras: false }, { texte: 'Cachets', gras: true }, { texte: '.', gras: false },
    ]);
    expect(cmp.lignes('## Étapes\n1. **Enregistrer**')).toEqual([
      { texte: 'Étapes', puce: false }, { texte: '**Enregistrer**', puce: true },
    ]);
    expect(cmp.segments('<img src=x>')).toEqual([{ texte: '<img src=x>', gras: false }]);
  });

  it('les puces de la réponse sont repérées, sans HTML injecté', () => {
    const l = cmp.lignes('Titre\n- un\n2) deux\n<b>gras</b>');
    expect(l).toEqual([
      { texte: 'Titre', puce: false }, { texte: 'un', puce: true },
      { texte: 'deux', puce: true }, { texte: '<b>gras</b>', puce: false },
    ]);
  });
});
