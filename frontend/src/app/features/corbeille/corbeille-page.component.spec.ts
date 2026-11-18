import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { CorbeilleService, ElementCorbeille } from '../../core/services/corbeille.service';
import { ToastService } from '../../core/services/toast.service';
import { CorbeillePageComponent } from './corbeille-page.component';

const E = (type: any, id: string, p: Partial<ElementCorbeille> = {}): ElementCorbeille => ({
  type, libelle_type: type, id, titre: `T-${id}`, contexte: 'P-1 › Prop', deleted_at: '2026-11-18T09:36:00Z',
  deleted_by: 'Youssef', enfants_actifs: 0, parent_en_corbeille: false, verrouille: false, ...p,
});

describe('CorbeillePageComponent', () => {
  let fixture: ComponentFixture<CorbeillePageComponent>;
  let cmp: CorbeillePageComponent;
  let svc: jasmine.SpyObj<CorbeilleService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    svc = jasmine.createSpyObj('CorbeilleService', ['lister', 'restaurer', 'purger']);
    svc.lister.and.returnValue(of({ total: 3, resultats: [
      E('piece', 'a'), E('ssdgps', 'b', { enfants_actifs: 2 }), E('piece', 'c', { verrouille: true, parent_en_corbeille: true })] }));
    toast = jasmine.createSpyObj('ToastService', ['success', 'warning', 'error']);
    TestBed.configureTestingModule({
      declarations: [CorbeillePageComponent], imports: [FormsModule], schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: CorbeilleService, useValue: svc }, { provide: ToastService, useValue: toast }],
    });
    fixture = TestBed.createComponent(CorbeillePageComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('liste, compte par type, filtre et recherche', () => {
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(3);
    expect(cmp.compte('piece')).toBe(2);
    cmp.filtreType = 'ssdgps';
    expect(cmp.visibles.map(e => e.id)).toEqual(['b']);
    cmp.filtreType = 'tous';
    cmp.recherche = 't-c';
    expect(cmp.visibles.map(e => e.id)).toEqual(['c']);
  });

  it('raisons de blocage', () => {
    expect(cmp.blocage(cmp.elements[0])).toBe('');
    expect(cmp.blocage(cmp.elements[1])).toBe('2 sous-élément(s) actif(s)');
    expect(cmp.blocage(cmp.elements[2])).toBe('Dossier figé');
  });

  it('sélection et restauration en lot', () => {
    cmp.basculerTout();
    expect(cmp.selection.size).toBe(3);
    cmp.basculerTout();
    expect(cmp.selection.size).toBe(0);
    svc.restaurer.and.returnValue(of({ restaures: 1, erreurs: [] }));
    cmp.restaurer([cmp.elements[0]]);
    expect(svc.restaurer).toHaveBeenCalledWith([{ type: 'piece', id: 'a' }]);
    expect(toast.success).toHaveBeenCalled();
    expect(svc.lister).toHaveBeenCalledTimes(2);
  });

  it('suppression définitive après confirmation ; refus partiels signalés', () => {
    cmp.demanderPurge([cmp.elements[1]]);
    expect(cmp.confirmerPurge).toBeTrue();
    expect(cmp.libellePurge).toBe('T-b');
    svc.purger.and.returnValue(of({ supprimes: 0, erreurs: [{ type: 'ssdgps', id: 'b', detail: '2 sous-élément(s) actif(s)' }] }));
    cmp.purger();
    expect(svc.purger).toHaveBeenCalledWith([{ type: 'ssdgps', id: 'b' }]);
    expect(cmp.confirmerPurge).toBeFalse();
    expect(toast.warning).toHaveBeenCalled();
  });
});
