import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { ActiviteComponent, ActiviteService, echelle, libelleMois } from './activite.component';
import { environment } from '../../../../environments/environment';

const M = (mois: string, crees: number): any => ({ mois, crees, soumis: 0, valides: 0, rejetes: 0, clos: 0, rapports: crees });
const DONNEES: any = {
  periode: { depuis: '2026-09-01', jusqu_a: '2026-11-16' }, totaux: { crees: 7, soumis: 0, valides: 0, rejetes: 0, clos: 0, rapports: 7 },
  delai_validation_jours: 2.5, taux_rejet: 0.25, en_attente: 1,
  par_mois: [M('2026-09', 2), M('2026-10', 0), M('2026-11', 5)],
  operateurs: [{ id: 1, nom: 'B', email: 'b@x', crees: 1, soumissions: 3, rejets_recus: 0, rapports: 0, appels_ia: 2, jetons_ia: 1500 },
               { id: 2, nom: 'A', email: 'a@x', crees: 6, soumissions: 1, rejets_recus: 1, rapports: 0, appels_ia: 0, jetons_ia: 0 }],
};

describe('ActiviteService', () => {
  it('transmet la période', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(ActiviteService);
    const http = TestBed.inject(HttpTestingController);
    svc.charger('2026-01-01', '2026-11-16').subscribe();
    const req = http.expectOne(r => r.url === `${environment.apiUrl}/v1/analytics/activite/`);
    expect(req.request.params.get('depuis')).toBe('2026-01-01');
    http.verify();
  });
});

describe('ActiviteComponent', () => {
  let svc: any;
  let cmp: ActiviteComponent;

  beforeEach(() => {
    svc = { charger: jasmine.createSpy('charger').and.returnValue(of(DONNEES)) };
    cmp = new ActiviteComponent(svc);
    cmp.ngOnInit();
  });

  it('utilitaires : mois et échelle de l’axe', () => {
    expect(libelleMois('2026-11')).toBe('nov. 26');
    expect([echelle(0), echelle(7), echelle(13), echelle(48)]).toEqual([1, 10, 20, 50]);
  });

  it('barres proportionnelles à l’échelle de l’indicateur choisi', () => {
    expect(cmp.max).toBe(5);
    expect(cmp.barres.map(b => b.hauteur)).toEqual([40, 0, 100]);
    expect(cmp.graduations).toEqual([5, 2.5, 0]);
  });

  it('tri des opérateurs et formats', () => {
    expect(cmp.operateurs.map(o => o.nom)).toEqual(['A', 'B']);
    cmp.tri = 'soumissions';
    expect(cmp.operateurs[0].nom).toBe('B');
    expect(cmp.pourcent(0.25)).toBe('25 %');
    expect(cmp.pourcent(null)).toBe('—');
    expect(cmp.jetons(1500)).toBe('1.5 k');
  });

  it('période : recharge ; 403 → message', () => {
    cmp.choisirPeriode('3m');
    expect(svc.charger).toHaveBeenCalledTimes(2);
    svc.charger.and.returnValue(throwError(() => ({ status: 403 })));
    cmp.charger();
    expect(cmp.erreur).toContain('encadrement');
  });
});
