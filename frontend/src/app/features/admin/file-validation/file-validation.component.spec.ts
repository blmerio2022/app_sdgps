import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { FileValidationComponent } from './file-validation.component';
import { FileValidationService } from '../../../core/services/file-validation.service';
import { environment } from '../../../../environments/environment';

const D = (id: string, jours: number, coherence: any = { ok: true, erreurs: 0, avertissements: 0, anomalies: [], pieces: 3 }): any => ({
  id, numero_ssdgps: 1, nature_ssdgps: 'PDC/GPS', type_ssdgps: 'mono-session', statut: 'soumis', statut_display: 'Soumis',
  projet_id: 'p1', projet_code: 'P-01', projet_nom: 'Projet', propriete_nom: 'Zaytoun', affaire_numero: 4,
  organisation: 'Cabinet', depuis: '2026-11-10T10:00:00Z', attente_jours: jours, par: 'Agent A', redacteur: 'Agent A', coherence,
});

describe('FileValidationService', () => {
  it('file + décision groupée', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(FileValidationService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${environment.apiUrl}/v1/ssdgps/`;
    svc.file('valide').subscribe();
    expect(http.expectOne(r => r.url === `${base}a-valider/`).request.params.get('statut')).toBe('valide');
    svc.decider(['a', 'b'], 'rejeter', 'motif').subscribe();
    const req = http.expectOne(`${base}transition-groupee/`);
    expect(req.request.body).toEqual({ ids: ['a', 'b'], action: 'rejeter', motif: 'motif' });
    http.verify();
  });
});

describe('FileValidationComponent', () => {
  let svc: any;
  let toast: any;
  let router: any;
  let cmp: FileValidationComponent;

  beforeEach(() => {
    svc = {
      file: jasmine.createSpy('file').and.returnValue(of({ encadrement: true, statut: 'soumis', compteurs: { soumis: 2, valide: 1 },
        results: [D('a', 9, { ok: false, erreurs: 1, avertissements: 2, anomalies: ['Trou RDN'], pieces: 4 }), D('b', 0)] })),
      decider: jasmine.createSpy('decider').and.returnValue(of({ reussis: 1, echecs: 1,
        resultats: [{ id: 'a', ok: true }, { id: 'b', ok: false, detail: 'Refusé' }] })),
    };
    toast = jasmine.createSpyObj('Toast', ['success', 'error']);
    router = { url: '/admin/file-validation', navigateByUrl: jasmine.createSpy('nav') };
    cmp = new FileValidationComponent(svc, toast, router);
    cmp.ngOnInit();
  });

  it('charge la file et repère les retards', () => {
    expect(cmp.dossiers.length).toBe(2);
    expect(cmp.compteurs.soumis).toBe(2);
    expect(cmp.enRetard).toBe(1);
    expect(cmp.attenteLibelle(cmp.dossiers[1])).toBe("aujourd'hui");
    expect(cmp.coherenceLibelle(cmp.dossiers[0])).toBe('1 erreur, 2 avertissements');
    expect(cmp.coherenceClasse(cmp.dossiers[0])).toBe('erreur');
    expect(cmp.coherenceLibelle(cmp.dossiers[1])).toBe('Cohérent');
  });

  it('filtre local, sélection globale', () => {
    cmp.recherche = 'zaytoun';
    expect(cmp.visibles.length).toBe(2);
    cmp.recherche = 'inexistant';
    expect(cmp.visibles.length).toBe(0);
    cmp.recherche = '';
    cmp.toutBasculer();
    expect(cmp.selection.size).toBe(2);
    expect(cmp.toutCoche).toBeTrue();
    cmp.toutBasculer();
    expect(cmp.selection.size).toBe(0);
  });

  it('rejet : motif obligatoire, puis décision groupée et rapport des refus', () => {
    cmp.demander('rejeter', ['a', 'b']);
    expect(cmp.motifObligatoire).toBeTrue();
    cmp.confirmer();
    expect(svc.decider).not.toHaveBeenCalled();
    cmp.motif = ' LPA non signée ';
    cmp.confirmer();
    expect(svc.decider).toHaveBeenCalledWith(['a', 'b'], 'rejeter', 'LPA non signée');
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.decision).toBeNull();
    expect(svc.file).toHaveBeenCalledTimes(2);
  });

  it('changer d’onglet recharge et vide la sélection ; ouvrir garde le préfixe admin', () => {
    cmp.selection.add('a');
    cmp.choisir('valide');
    expect(svc.file).toHaveBeenCalledWith('valide');
    expect(cmp.selection.size).toBe(0);
    cmp.ouvrir(D('x', 1));
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/projets/p1/pieces/x');
  });

  it('erreur de chargement', () => {
    svc.file.and.returnValue(throwError(() => ({ status: 500 })));
    cmp.charger();
    expect(cmp.erreur).toContain('impossible');
  });
});
