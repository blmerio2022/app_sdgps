import { ElementRef } from '@angular/core';
import { of, throwError } from 'rxjs';
import { IaRedactionComponent, LONGUEUR_OBSERVATION, designation } from './ia-redaction.component';

const PIECES: any[] = [
  { id: 'p1', type_piece: 'PPA', type_piece_display: 'Photos des points anciens', ordre: 1, commentaire: 'Ancienne', payload: {} },
  { id: 'p0', type_piece: 'LPA', type_piece_display: 'Liste des points anciens', ordre: 0, commentaire: '', payload: {} },
  { id: 'pg', type_piece: 'PGSDGPS', type_piece_display: 'Page de garde', ordre: 2, payload: {} },
];

describe('IaRedactionComponent (n°6 — gestion des observations)', () => {
  let ia: any;
  let pieces: any;
  let cmp: IaRedactionComponent;

  beforeEach(() => {
    ia = {
      disponible$: of(true),
      observations: jasmine.createSpy('observations').and.returnValue(of({ propositions: [
        { piece: 'p1', designation: '', observation_actuelle: '', observation: 'Quinze points photographiés.' }] })),
      appliquerObservations: jasmine.createSpy('appliquer').and.returnValue(of({ modifiees: 1, ignorees: 0 })),
      supprimerObservations: jasmine.createSpy('supprimer').and.returnValue(of({ supprimees: 1 })),
      historiqueObservations: jasmine.createSpy('historique').and.returnValue(of([
        { id: 7, piece: 'p1', designation: '', texte: 'Version A', motif: 'supprimee', motif_display: 'Supprimée',
          created_at: '2026-11-15T10:00:00Z', created_by: 'Y' }])),
      restaurerObservation: jasmine.createSpy('restaurer').and.returnValue(of({ piece: 'p1', texte: 'Version A' })),
      synthese: jasmine.createSpy('synthese').and.returnValue(of({ texte: 'Le dossier comprend…' })),
    };
    pieces = { listBySsdgps: jasmine.createSpy('list').and.returnValue(of(PIECES)) };
    cmp = new IaRedactionComponent(ia, pieces, new ElementRef(document.createElement('div')));
    cmp.ssdgpsId = 's1';
    cmp.ngOnInit();
    cmp.ouvrirObservations();
  });

  it('liste les pièces avec leur observation, sans appeler l’IA, page de garde exclue', () => {
    expect(ia.observations).not.toHaveBeenCalled();
    expect(cmp.lignes.map(l => l.piece)).toEqual(['p0', 'p1']);       // triées par ordre
    expect(cmp.nbActuelles).toBe(1);
    expect(cmp.aEnregistrer.length).toBe(0);
  });

  it('rédige toutes les pièces avec la consigne générale', () => {
    cmp.consigne = 'Ton bref';
    cmp.rediger();
    expect(ia.observations).toHaveBeenCalledWith('s1', { pieces: undefined, consigne: 'Ton bref', consignes: {} });
    const l = cmp.lignes.find(x => x.piece === 'p1')!;
    expect(l.texte).toBe('Quinze points photographiés.');
    expect(l.propose).toBeTrue();
    expect(cmp.aEnregistrer.length).toBe(1);
  });

  it('régénère une seule pièce avec sa propre consigne', () => {
    const l = cmp.lignes.find(x => x.piece === 'p1')!;
    l.consigne = 'Préciser la projection';
    cmp.regenerer(l);
    expect(ia.observations).toHaveBeenCalledWith('s1', { pieces: ['p1'], consigne: '',
                                                        consignes: { p1: 'Préciser la projection' } });
  });

  it('la sélection limite la rédaction', () => {
    cmp.lignes[0].selection = true;
    cmp.rediger();
    expect(ia.observations.calls.mostRecent().args[1].pieces).toEqual(['p0']);
  });

  it('enregistre seulement ce qui a changé, puis prévient la page', () => {
    const emis: number[] = [];
    cmp.enregistre.subscribe(n => emis.push(n));
    cmp.lignes[0].texte = 'x'.repeat(LONGUEUR_OBSERVATION);
    cmp.enregistrer();
    expect(ia.appliquerObservations).toHaveBeenCalledWith('s1', [{ piece: 'p0', texte: 'x'.repeat(LONGUEUR_OBSERVATION) }]);
    expect(cmp.lignes[0].actuelle.length).toBe(LONGUEUR_OBSERVATION);
    expect(emis).toEqual([1]);
  });

  it('annuler une proposition revient au texte enregistré', () => {
    cmp.rediger();
    const l = cmp.lignes.find(x => x.piece === 'p1')!;
    cmp.annulerEdition(l);
    expect(l.texte).toBe('Ancienne');
    expect(l.propose).toBeFalse();
  });

  it('supprime une observation, la sélection, ou toutes', () => {
    const l = cmp.lignes.find(x => x.piece === 'p1')!;
    cmp.supprimer(l);
    expect(ia.supprimerObservations).toHaveBeenCalledWith('s1', ['p1']);
    expect(l.actuelle).toBe('');
    l.actuelle = 'Remise';
    cmp.confirmeTout = true;
    cmp.supprimerTout();
    expect(ia.supprimerObservations).toHaveBeenCalledWith('s1', 'toutes');
    expect(cmp.nbActuelles).toBe(0);
    expect(cmp.confirmeTout).toBeFalse();
  });

  it('historique puis restauration', () => {
    const l = cmp.lignes.find(x => x.piece === 'p1')!;
    cmp.basculerHistorique(l);
    expect(ia.historiqueObservations).toHaveBeenCalledWith('s1', 'p1');
    expect(l.historique?.length).toBe(1);
    cmp.restaurer(l, l.historique![0]);
    expect(ia.restaurerObservation).toHaveBeenCalledWith(7);
    expect(l.actuelle).toBe('Version A');
    expect(l.historique).toBeNull();
  });

  it('dossier figé : ni rédaction, ni suppression, ni enregistrement', () => {
    cmp.verrouille = true;
    cmp.rediger();
    cmp.supprimerTout();
    cmp.lignes[0].texte = 'x';
    cmp.enregistrer();
    expect(ia.observations).not.toHaveBeenCalled();
    expect(ia.supprimerObservations).not.toHaveBeenCalled();
    expect(ia.appliquerObservations).not.toHaveBeenCalled();
  });

  it('erreur de l’IA : message, aucune ligne bloquée', () => {
    ia.observations.and.returnValue(throwError(() => ({ status: 502, error: { detail: 'Service saturé' } })));
    cmp.rediger();
    expect(cmp.erreur).toBe('Service saturé');
    expect(cmp.lignes.every(l => !l.enCours)).toBeTrue();
  });

  it('fermer avec des modifications non enregistrées demande confirmation', () => {
    cmp.lignes[0].texte = 'non enregistré';
    spyOn(window, 'confirm').and.returnValue(false);
    cmp.fermer();
    expect(cmp.modale).toBe('observations');
  });

  it('note de synthèse', () => {
    cmp.ouvrirSynthese();
    expect(cmp.synthese).toBe('Le dossier comprend…');
  });

  it('designation()', () => {
    expect(designation({ type_piece: 'RDN', type_piece_display: 'Rapport de détermination', numero: 2,
                         session_numero: 1 } as any)).toBe('Rapport de détermination n°2 · session 1');
  });
});
