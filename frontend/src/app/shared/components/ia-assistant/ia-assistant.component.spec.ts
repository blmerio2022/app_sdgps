import { of, throwError } from 'rxjs';
import { CLE_AGRANDI, CLE_DISCUSSION, IaAssistantComponent } from './ia-assistant.component';

function msg(id: number, role: 'user' | 'assistant', contenu: string): any {
  return { id, role, contenu, actions: [], outils: [], modele: 'm', created_at: '2026-11-15T10:00:00Z' };
}

describe('IaAssistantComponent (n°5 — discussions)', () => {
  let ia: any;
  let router: any;
  let cmp: IaAssistantComponent;

  beforeEach(() => {
    localStorage.removeItem(CLE_DISCUSSION);
    localStorage.removeItem(CLE_AGRANDI);
    ia = {
      disponible$: of(true),
      conversations: jasmine.createSpy('conversations').and.returnValue(of([
        { id: 'c1', titre: 'Cachets', epinglee: true, archivee: false, created_at: '', updated_at: '2026-11-15T09:00:00Z' },
      ])),
      creerConversation: jasmine.createSpy('creer').and.returnValue(of({
        id: 'n1', titre: 'Nouvelle discussion', epinglee: false, archivee: false, created_at: '', updated_at: '', messages: [] })),
      conversation: jasmine.createSpy('conversation').and.returnValue(of({
        id: 'c1', titre: 'Cachets', epinglee: true, archivee: false, created_at: '', updated_at: '',
        messages: [msg(1, 'user', 'Comment apposer mon cachet ?'), msg(2, 'assistant', 'Allez dans **Paramètres** › Cachets.')] })),
      envoyerMessage: jasmine.createSpy('envoyer').and.returnValue(of({
        question: msg(10, 'user', 'Bonjour'), message: msg(11, 'assistant', 'Bonjour !'), titre: 'Bonjour' })),
      regenerer: jasmine.createSpy('regenerer').and.returnValue(of({ message: msg(12, 'assistant', 'Nouvelle réponse') })),
      modifierConversation: jasmine.createSpy('modifier').and.callFake((id: string, ch: any) =>
        of({ id, titre: 'Cachets', epinglee: true, archivee: false, created_at: '', updated_at: '', ...ch })),
      supprimerConversation: jasmine.createSpy('supprimer').and.returnValue(of(null)),
      exporter: jasmine.createSpy('exporter').and.returnValue(of({ nom_fichier: 'x.md', contenu: '# x' })),
    };
    router = { url: '/projets', navigateByUrl: jasmine.createSpy('navigateByUrl') };
    cmp = new IaAssistantComponent(ia, router);
    cmp.ngOnInit();
  });

  afterEach(() => { localStorage.removeItem(CLE_DISCUSSION); localStorage.removeItem(CLE_AGRANDI); cmp.ngOnDestroy(); });

  it('masqué si l’IA n’est pas activée', () => {
    ia.disponible$ = of(false);
    const autre = new IaAssistantComponent(ia, router);
    autre.ngOnInit();
    expect(autre.disponible).toBeFalse();
  });

  it('à l’ouverture : charge la liste et rouvre la dernière discussion', () => {
    localStorage.setItem(CLE_DISCUSSION, 'c1');
    cmp.basculer();
    expect(ia.conversations).toHaveBeenCalledWith('', 'actives');
    expect(ia.conversation).toHaveBeenCalledWith('c1');
    expect(cmp.courante?.titre).toBe('Cachets');
    expect(cmp.messages.length).toBe(2);
  });

  it('premier message : crée la discussion puis l’enregistre avec son titre automatique', () => {
    cmp.envoyer('Bonjour');
    expect(ia.creerConversation).toHaveBeenCalled();
    expect(ia.envoyerMessage).toHaveBeenCalledWith('n1', 'Bonjour');
    expect(cmp.messages.map(m => m.id)).toEqual([10, 11]);         // la bulle provisoire est remplacée
    expect(cmp.courante?.titre).toBe('Bonjour');
    expect(localStorage.getItem(CLE_DISCUSSION)).toBe('n1');
  });

  it('une erreur garde la question et propose de réessayer (régénération)', () => {
    ia.envoyerMessage.and.returnValue(throwError(() => ({ status: 502, error: { detail: 'Service saturé' } })));
    cmp.envoyer('Bonjour');
    expect(cmp.erreur).toBe('Service saturé');
    expect(cmp.derniereSansReponse).toBeTrue();
    cmp.regenerer();
    expect(ia.regenerer).toHaveBeenCalledWith('n1');
    expect(cmp.messages[cmp.messages.length - 1].contenu).toBe('Nouvelle réponse');
  });

  it('régénérer remplace la dernière réponse', () => {
    cmp.ouvrir('c1');
    cmp.regenerer();
    expect(cmp.messages.map(m => m.contenu)).toEqual(['Comment apposer mon cachet ?', 'Nouvelle réponse']);
  });

  it('recherche des discussions : appel serveur différé', (done) => {
    cmp.onRecherche('zaytoun');
    setTimeout(() => {
      expect(ia.conversations).toHaveBeenCalledWith('zaytoun', 'actives');
      done();
    }, 350);
  });

  it('renommer, épingler, archiver, supprimer, exporter', () => {
    cmp.discussions = [{ id: 'c1', titre: 'Cachets', epinglee: false, archivee: false, created_at: '', updated_at: '' }];
    const d = cmp.discussions[0];
    cmp.commencerRenommage(d);
    cmp.titreEdite = 'Cachets et signatures';
    cmp.validerRenommage(d);
    expect(ia.modifierConversation).toHaveBeenCalledWith('c1', { titre: 'Cachets et signatures' });
    cmp.epingler(d, new Event('click'));
    expect(ia.modifierConversation).toHaveBeenCalledWith('c1', { epinglee: true });
    cmp.archiver(d);
    expect(ia.modifierConversation).toHaveBeenCalledWith('c1', { archivee: true });
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    cmp.exporter(d);
    expect(ia.exporter).toHaveBeenCalledWith('c1');
    cmp.confirmerSuppression(d);
    expect(ia.supprimerConversation).toHaveBeenCalledWith('c1');
    expect(cmp.discussions.length).toBe(0);
  });

  it('un titre vide ou inchangé n’est pas envoyé', () => {
    const d: any = { id: 'c1', titre: 'A', epinglee: false, archivee: false };
    cmp.commencerRenommage(d);
    cmp.titreEdite = '   ';
    cmp.validerRenommage(d);
    expect(ia.modifierConversation).not.toHaveBeenCalled();
  });

  it('recherche dans la discussion : surlignage sans HTML interprété', () => {
    cmp.chercheOuvert = true;
    cmp.cherche = 'cachet';
    const s = cmp.segments('Mon **Cachet** et mon cachet <b>');
    expect(s).toEqual([
      { texte: 'Mon ', gras: false, marque: false },
      { texte: 'Cachet', gras: true, marque: true },
      { texte: ' et mon ', gras: false, marque: false },
      { texte: 'cachet', gras: false, marque: true },
      { texte: ' <b>', gras: false, marque: false },
    ]);
    cmp.fermerRecherche();
    expect(cmp.segments('cachet')[0].marque).toBeFalse();
  });

  it('extrait de recherche surligné', () => {
    cmp.recherche = 'zay';
    expect(cmp.extraitSurligne('Ferme Zaytoun').map(s => s.marque)).toEqual([false, true, false]);
  });

  it('agrandir est mémorisé', () => {
    cmp.basculerAgrandi();
    expect(localStorage.getItem(CLE_AGRANDI)).toBe('1');
  });

  it('un bouton d’action navigue dans le même espace (opérateur ou admin)', () => {
    const action = { action: 'gerer_cachets', libelle: 'x', route: 'parametres/cachets-signatures' };
    cmp.agir(action);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/parametres/cachets-signatures');
    router.url = '/admin/projets';
    cmp.agir(action);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/parametres/cachets-signatures');
  });

  it('les tableaux Markdown deviennent des lignes lisibles', () => {
    expect(cmp.lignes('| SDGPS | Statut |\n|---|:---:|\n| n°4 | En cours |')).toEqual([
      { texte: 'SDGPS · Statut', puce: true }, { texte: 'n°4 · En cours', puce: true },
    ]);
  });

  it('les lignes Markdown : puces repérées, titres nettoyés', () => {
    expect(cmp.lignes('## Étapes\n1. **Enregistrer**\n- un')).toEqual([
      { texte: 'Étapes', puce: false }, { texte: '**Enregistrer**', puce: true }, { texte: 'un', puce: true },
    ]);
  });

  it('Entrée envoie, Maj+Entrée va à la ligne', () => {
    cmp.brouillon = 'Bonjour';
    cmp.onToucheSaisie(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(ia.envoyerMessage).not.toHaveBeenCalled();
    cmp.onToucheSaisie(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(ia.envoyerMessage).toHaveBeenCalled();
  });
});
