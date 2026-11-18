import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { QualiteDossierService } from './qualite-dossier.service';
import { CorbeilleService } from './corbeille.service';
import { CarteDossiersService } from './carte-dossiers.service';

const API = `${environment.apiUrl}/v1/`;

describe('Services qualité / corbeille / carte', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('contrôle croisé, avec ou sans session', () => {
    const svc = TestBed.inject(QualiteDossierService);
    svc.controleCroise('s1').subscribe();
    let req = http.expectOne(r => r.url === `${API}ssdgps/s1/controle-croise/`);
    expect(req.request.params.has('session')).toBeFalse();
    req.flush({});
    svc.controleCroise('s1', 'sess').subscribe();
    req = http.expectOne(r => r.url === `${API}ssdgps/s1/controle-croise/`);
    expect(req.request.params.get('session')).toBe('sess');
    req.flush({});
  });

  it('remarques : lecture, ajout, opérations, suppression', () => {
    const svc = TestBed.inject(QualiteDossierService);
    svc.remarques('s1').subscribe();
    http.expectOne({ method: 'GET', url: `${API}ssdgps/s1/remarques/` }).flush({});
    svc.ajouterRemarque('s1', 'σ faux', 'p1', 'BT11').subscribe();
    const ajout = http.expectOne({ method: 'POST', url: `${API}ssdgps/s1/remarques/` });
    expect(ajout.request.body).toEqual({ texte: 'σ faux', piece: 'p1', ligne: 'BT11' });
    ajout.flush({});
    svc.operationRemarque('s1', 'r1', 'corriger', 'fait').subscribe();
    const op = http.expectOne({ method: 'POST', url: `${API}ssdgps/s1/remarques/r1/corriger/` });
    expect(op.request.body).toEqual({ reponse: 'fait' });
    op.flush({});
    svc.supprimerRemarque('s1', 'r1').subscribe();
    http.expectOne({ method: 'DELETE', url: `${API}ssdgps/s1/remarques/r1/` }).flush({});
  });

  it('corbeille : liste, restauration, purge', () => {
    const svc = TestBed.inject(CorbeilleService);
    svc.lister().subscribe();
    http.expectOne({ method: 'GET', url: `${API}corbeille/` }).flush({ total: 0, resultats: [] });
    svc.restaurer([{ type: 'piece', id: 'p1' }]).subscribe();
    const r = http.expectOne({ method: 'POST', url: `${API}corbeille/restaurer/` });
    expect(r.request.body).toEqual({ elements: [{ type: 'piece', id: 'p1' }] });
    r.flush({ erreurs: [] });
    svc.purger([{ type: 'projet', id: 'x' }]).subscribe();
    http.expectOne({ method: 'POST', url: `${API}corbeille/purger/` }).flush({ erreurs: [] });
  });

  it('carte des dossiers', () => {
    TestBed.inject(CarteDossiersService).charger().subscribe();
    http.expectOne({ method: 'GET', url: `${API}carte-dossiers/` }).flush({ dossiers: [], sans_position: 0, total: 0 });
  });
});
