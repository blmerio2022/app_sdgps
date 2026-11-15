import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { PieceVersionsComponent } from './piece-versions.component';
import { PieceVersionsService } from '../../../core/services/piece-versions.service';
import { environment } from '../../../../environments/environment';

const HIST: any = {
  courante: { numero: null, statut: 'brouillon', auteur: 'A', date_contenu: '2026-11-15T10:00:00Z', lignes: 2 },
  versions: [{ numero: 2, statut: 'valide', auteur: 'B', date_contenu: '2026-11-14T10:00:00Z', lignes: 3, origine: 'modification' },
             { numero: 1, statut: 'brouillon', auteur: 'B', date_contenu: '2026-11-13T10:00:00Z', lignes: 1, origine: 'modification' }],
};
const DIFF: any = { de: 2, vers: 'courante', ajoutees: [{ id: 3, point: 'C' }], supprimees: [], identiques: 1,
  modifiees: [{ avant: { id: 1, x: '1' }, apres: { id: 1, x: '2' }, colonnes: ['x'] }], autres_cles: [] };

describe('PieceVersionsService', () => {
  it('historique, comparer, restaurer', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(PieceVersionsService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${environment.apiUrl}/v1/pieces/p1/versions/`;
    svc.historique('p1').subscribe();
    http.expectOne(base).flush(HIST);
    svc.comparer('p1', 2, 1).subscribe();
    expect(http.expectOne(r => r.url === `${base}2/comparer/`).request.params.get('avec')).toBe('1');
    svc.restaurer('p1', 2).subscribe();
    expect(http.expectOne(`${base}2/restaurer/`).request.method).toBe('POST');
    http.verify();
  });
});

describe('PieceVersionsComponent', () => {
  let svc: any;
  let cmp: PieceVersionsComponent;

  beforeEach(() => {
    svc = {
      historique: jasmine.createSpy('historique').and.returnValue(of(HIST)),
      comparer: jasmine.createSpy('comparer').and.returnValue(of(DIFF)),
      restaurer: jasmine.createSpy('restaurer').and.returnValue(of({ id: 'p1' })),
    };
    cmp = new PieceVersionsComponent(svc);
    cmp.pieceId = 'p1';
    cmp.ngOnInit();
  });

  it('charge l’historique et compare d’office la version la plus récente', () => {
    expect(cmp.historique?.versions.length).toBe(2);
    expect(svc.comparer).toHaveBeenCalledWith('p1', 2);
    expect(cmp.identique).toBeFalse();
    expect(cmp.colonnes({ id: 3, point: 'C', vide: '' })).toEqual(['point']);
    expect(cmp.valeur('')).toBe('∅');
  });

  it('restaurer émet la pièce et recharge ; impossible sur dossier figé', () => {
    const emis = spyOn(cmp.restauree, 'emit');
    cmp.restaurer();
    expect(svc.restaurer).toHaveBeenCalledWith('p1', 2);
    expect(emis).toHaveBeenCalled();
    expect(svc.historique).toHaveBeenCalledTimes(2);
    svc.restaurer.calls.reset();
    cmp.verrouille = true;
    cmp.restaurer();
    expect(svc.restaurer).not.toHaveBeenCalled();
  });

  it('erreur de restauration affichée', () => {
    svc.restaurer.and.returnValue(throwError(() => ({ error: { detail: 'Dossier figé' } })));
    cmp.restaurer();
    expect(cmp.erreur).toBe('Dossier figé');
  });

  it('contenu identique détecté', () => {
    svc.comparer.and.returnValue(of({ ...DIFF, ajoutees: [], modifiees: [] }));
    cmp.choisir(HIST.versions[1]);
    expect(cmp.identique).toBeTrue();
  });
});
