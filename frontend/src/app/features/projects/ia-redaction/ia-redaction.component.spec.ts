import { ElementRef } from '@angular/core';
import { of, throwError } from 'rxjs';
import { IaRedactionComponent, LONGUEUR_OBSERVATION } from './ia-redaction.component';

const PROPOSITIONS = [
  { piece: 'p1', designation: 'Photos des points anciens', observation_actuelle: '', observation: 'Deux points.' },
  { piece: 'p2', designation: 'Rapport des observations brutes', observation_actuelle: 'ancienne',
    observation: '1 durée hors tolérance.' },
];

describe('IaRedactionComponent (n°6)', () => {
  let ia: any;
  let pieces: any;
  let cmp: IaRedactionComponent;

  beforeEach(() => {
    ia = {
      disponible$: of(true),
      observations: jasmine.createSpy('observations').and.returnValue(of({ propositions: PROPOSITIONS })),
      synthese: jasmine.createSpy('synthese').and.returnValue(of({ texte: 'Le dossier comprend…' })),
    };
    pieces = { update: jasmine.createSpy('update').and.returnValue(of({})) };
    cmp = new IaRedactionComponent(ia, pieces, new ElementRef(document.createElement('div')));
    cmp.ssdgpsId = 's1';
    cmp.ngOnInit();
  });

  it('masqué si l’IA n’est pas activée', () => {
    ia.disponible$ = of(false);
    const autre = new IaRedactionComponent(ia, pieces, new ElementRef(document.createElement('div')));
    autre.ngOnInit();
    expect(autre.disponible).toBeFalse();
  });

  it('propose une observation par pièce, toutes cochées', () => {
    cmp.ouvrirObservations();
    expect(ia.observations).toHaveBeenCalledWith('s1');
    expect(cmp.modale).toBe('observations');
    expect(cmp.lignes.length).toBe(2);
    expect(cmp.nbRetenues).toBe(2);
  });

  it('n’enregistre que les observations retenues, par l’API des pièces', () => {
    const emis: number[] = [];
    cmp.enregistre.subscribe(n => emis.push(n));
    cmp.ouvrirObservations();
    cmp.lignes[1].retenue = false;
    cmp.lignes[0].observation = 'x'.repeat(LONGUEUR_OBSERVATION + 40);
    cmp.enregistrerObservations();
    expect(pieces.update).toHaveBeenCalledTimes(1);
    const [id, corps] = pieces.update.calls.mostRecent().args;
    expect(id).toBe('p1');
    expect(corps.commentaire.length).toBe(LONGUEUR_OBSERVATION);
    expect(emis).toEqual([1]);
    expect(cmp.modale).toBeNull();
  });

  it('dossier figé : rien n’est demandé', () => {
    cmp.verrouille = true;
    cmp.ouvrirObservations();
    expect(ia.observations).not.toHaveBeenCalled();
  });

  it('erreur d’enregistrement : la modale reste ouverte avec le message', () => {
    pieces.update.and.returnValue(throwError(() => ({ error: { detail: 'Dossier figé.' } })));
    cmp.ouvrirObservations();
    cmp.enregistrerObservations();
    expect(cmp.erreur).toBe('Dossier figé.');
    expect(cmp.modale).toBe('observations');
  });

  it('note de synthèse : génération puis régénération', () => {
    cmp.ouvrirSynthese();
    expect(cmp.synthese).toBe('Le dossier comprend…');
    ia.synthese.and.returnValue(throwError(() => ({ status: 503, error: { detail: 'IA inactive' } })));
    cmp.genererSynthese();
    expect(cmp.erreur).toBe('IA inactive');
    expect(cmp.synthese).toBe('');
  });

  it('Échap ferme la fenêtre, mais pas pendant un enregistrement', () => {
    cmp.ouvrirSynthese();
    cmp.enregistrement = true;
    cmp.echap();
    expect(cmp.modale).toBe('synthese');
    cmp.enregistrement = false;
    cmp.echap();
    expect(cmp.modale).toBeNull();
  });

  it('un clic hors du composant referme le menu', () => {
    cmp.basculerMenu(new Event('click'));
    expect(cmp.menuOuvert).toBeTrue();
    cmp.clicDocument({ target: document.body } as any);
    expect(cmp.menuOuvert).toBeFalse();
  });
});
