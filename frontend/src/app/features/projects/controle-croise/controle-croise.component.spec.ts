import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { QualiteDossierService } from '../../../core/services/qualite-dossier.service';
import { ControleCroiseComponent } from './controle-croise.component';

const RESULTAT = {
  ok: false, erreurs: 1, avertissements: 1,
  sources: { LPA: { pieces: 1, points: 15 }, RDD: { pieces: 1, points: 14 } },
  controles: [
    { code: 'lpa_hors_rdd', gravite: 'erreur', titre: 'Points anciens absents de la détermination définitive',
      message: 'm', points: ['C'], nombre: 1, pieces: [{ id: 'p1', type_piece: 'LPA', libelle: 'Liste des Points Anciens' }] },
    { code: 'orthographe', gravite: 'avertissement', titre: 'Même point écrit de plusieurs façons', message: 'm',
      points: Array.from({ length: 30 }, (_, i) => `P${i}`), nombre: 30, pieces: [] },
  ],
};

describe('ControleCroiseComponent', () => {
  let fixture: ComponentFixture<ControleCroiseComponent>;
  let svc: { controleCroise: jasmine.Spy };
  let router: { url: string; navigate: jasmine.Spy };

  function creer(reponse: any, url = '/projets/x'): HTMLElement {
    svc = { controleCroise: jasmine.createSpy().and.returnValue(reponse) };
    router = { url, navigate: jasmine.createSpy('navigate') };
    TestBed.configureTestingModule({
      declarations: [ControleCroiseComponent],
      providers: [{ provide: QualiteDossierService, useValue: svc }, { provide: Router, useValue: router }],
    });
    fixture = TestBed.createComponent(ControleCroiseComponent);
    Object.assign(fixture.componentInstance, { ssdgpsId: 's1', projetId: 'pr1', sessionId: 'sess' });
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('lance le contrôle (session transmise) et affiche la synthèse et les écarts', () => {
    const el = creer(of(RESULTAT));
    expect(svc.controleCroise).toHaveBeenCalledWith('s1', 'sess');
    expect(el.textContent).toContain('1 erreur');
    expect(el.textContent).toContain('1 point à vérifier');
    expect(el.textContent).toContain('Points anciens absents de la détermination définitive');
    expect(el.querySelectorAll('.cc-controle').length).toBe(2);
  });

  it('tronque les longues listes de points puis les déplie', () => {
    creer(of(RESULTAT));
    const cmp = fixture.componentInstance;
    const c = RESULTAT.controles[1] as any;
    expect(cmp.points(c).length).toBe(24);
    expect(cmp.restants(c)).toBe(6);
    cmp.deplier(c);
    expect(cmp.points(c).length).toBe(30);
  });

  it('ouvre la pièce fautive dans la zone courante', () => {
    creer(of(RESULTAT), '/admin/projets/pr1/pieces/s1');
    const fermee = spyOn(fixture.componentInstance.fermee, 'emit');
    fixture.componentInstance.ouvrirPiece(RESULTAT.controles[0].pieces[0] as any);
    expect(fermee).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/projets', 'pr1', 'pieces', 's1', 'piece', 'p1']);
  });

  it('dossier concordant et erreur serveur', () => {
    let el = creer(of({ ...RESULTAT, ok: true, erreurs: 0, avertissements: 0, controles: [] }));
    expect(el.textContent).toContain('Tout concorde');
    TestBed.resetTestingModule();
    el = creer(throwError(() => ({ error: { detail: 'SDGPS introuvable.' } })));
    expect(el.textContent).toContain('SDGPS introuvable.');
  });
});
