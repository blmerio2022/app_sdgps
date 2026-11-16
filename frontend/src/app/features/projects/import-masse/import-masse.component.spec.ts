import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { ImportMasseComponent } from './import-masse.component';
import { ImportMasseService } from '../../../core/services/import-masse.service';
import { environment } from '../../../../environments/environment';

const C = (type: string, over: any = {}): any => ({ type_piece: type, libelle: type, score: 1, champs_reconnus: 5, champs_total: 5,
  nom_reconnu: false, repetable: false, niveau: 'ssdgps', mapping: { a: 'A' }, numero_nom: null, ...over });
const L = (over: any = {}): any => ({ fichier: 'LPA.csv', lisible: true, colonnes: ['A'], lignes: 3, candidats: [C('LPA')],
  type_piece: 'LPA', mapping: { a: 'A' }, numero: null, piece_existante: null, action: 'creer', ...over });

describe('ImportMasseService', () => {
  it('plan multipart puis import unitaire (création ou remplacement)', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(ImportMasseService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${environment.apiUrl}/v1/pieces/`;
    svc.plan('s1', [new File(['x'], 'a.csv'), new File(['y'], 'b.csv')]).subscribe();
    const p = http.expectOne(`${base}import-plan/`);
    expect((p.request.body as FormData).getAll('fichiers').length).toBe(2);
    p.flush({ plan: [] });
    svc.importer('s1', new File(['x'], 'a.csv'), L({ type_piece: 'RDN', numero: 2 }), 'sess').subscribe();
    const c = http.expectOne(`${base}import/`).request.body as FormData;
    expect([c.get('ssdgps'), c.get('session'), c.get('numero'), c.get('mapping')]).toEqual(['s1', 'sess', '2', '{"a":"A"}']);
    svc.importer('s1', new File(['x'], 'a.csv'), L({ action: 'remplacer', piece_existante: 'p9' }), null).subscribe();
    const r = http.expectOne(`${base}import/`).request.body as FormData;
    expect(r.get('piece_id')).toBe('p9');
    expect(r.has('ssdgps')).toBeFalse();
    http.verify();
  });
});

describe('ImportMasseComponent', () => {
  let svc: any;
  let cmp: ImportMasseComponent;
  const f1 = new File(['x'], 'LPA.csv');
  const f2 = new File(['y'], 'RDN.csv');

  beforeEach(() => {
    svc = {
      plan: jasmine.createSpy('plan').and.returnValue(of({ plan: [
        L(), L({ fichier: 'RDN.csv', candidats: [C('RDN', { repetable: true, niveau: 'session' }), C('RDD')],
                 type_piece: null, ambigu: true, mapping: {}, action: 'ignorer' })] })),
      importer: jasmine.createSpy('importer').and.callFake((_s: string, f: File) =>
        f.name === 'RDN.csv' ? throwError(() => ({ error: { numero: ['Déjà utilisé'] } })) : of({})),
    };
    cmp = new ImportMasseComponent(svc);
    cmp.ssdgpsId = 's1';
    cmp.multiSession = true;
    cmp.sessions = [{ id: 'sess1', numero_session: 1 }];
  });

  it('dépôt sans doublon puis analyse', () => {
    cmp.ajouter([f1, f2, f1]);
    expect(cmp.fichiers.length).toBe(2);
    cmp.analyser();
    expect(svc.plan).toHaveBeenCalledWith('s1', [f1, f2]);
    expect(cmp.etape).toBe('plan');
  });

  it('type choisi : correspondance du candidat, numéro, session requise en multi-session', () => {
    cmp.ajouter([f1, f2]);
    cmp.analyser();
    const rdn = cmp.plan[1];
    expect(cmp.aImporter).toBe(1);
    cmp.changerType(rdn, 'RDN');
    expect(rdn.mapping).toEqual({ a: 'A' });
    expect(rdn.numero).toBe(1);
    expect(cmp.blocage(rdn, 1)).toBe('Session requise');
    expect(cmp.pret).toBeFalse();
    cmp.sessionParLigne[1] = 'sess1';
    expect(cmp.pret).toBeTrue();
  });

  it('import séquentiel : un échec n’arrête pas les autres', () => {
    cmp.ajouter([f1, f2]);
    cmp.analyser();
    cmp.changerType(cmp.plan[1], 'RDN');
    cmp.sessionParLigne[1] = 'sess1';
    const fini = spyOn(cmp.termine, 'emit');
    cmp.importer();
    expect(svc.importer).toHaveBeenCalledTimes(2);
    expect(cmp.etape).toBe('fin');
    expect(cmp.reussis).toBe(1);
    expect(cmp.resultats[1].detail).toBe('numero : Déjà utilisé');
    expect(fini).toHaveBeenCalledWith(1);
  });

  it('analyse en échec : message du serveur', () => {
    svc.plan.and.returnValue(throwError(() => ({ error: { detail: 'Dossier figé' } })));
    cmp.ajouter([f1]);
    cmp.analyser();
    expect(cmp.erreur).toBe('Dossier figé');
  });
});
