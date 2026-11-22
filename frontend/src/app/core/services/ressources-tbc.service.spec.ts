import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RessourcesTbcService } from './ressources-tbc.service';
import { environment } from '../../../environments/environment';

describe('RessourcesTbcService', () => {
  let svc: RessourcesTbcService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/v1/ressources-tbc/`;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(RessourcesTbcService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lecture des ressources disponibles et de la gestion', () => {
    svc.disponibles().subscribe();
    expect(http.expectOne(base).request.method).toBe('GET');
    svc.gestion().subscribe();
    http.expectOne(`${base}gestion/`);
  });

  it("dépôt multipart : organisation transmise, rien pour l'application", () => {
    const f = new File(['x'], 'modele.vct');
    svc.deposer('etude_modele', f, 'org1', 'v1').subscribe();
    let corps = http.expectOne(base).request.body as FormData;
    expect([corps.get('type_ressource'), corps.get('organisation'), corps.get('description')]).toEqual(['etude_modele', 'org1', 'v1']);
    expect((corps.get('fichier') as File).name).toBe('modele.vct');
    svc.deposer('ruban', f, null).subscribe();
    corps = http.expectOne(base).request.body as FormData;
    expect(corps.has('organisation')).toBeFalse();
  });

  it('description, retrait, téléchargement en blob', () => {
    svc.modifierDescription('r1', 'v2').subscribe();
    const p = http.expectOne(`${base}r1/`);
    expect([p.request.method, p.request.body.description]).toEqual(['PATCH', 'v2']);
    svc.retirer('r1').subscribe();
    expect(http.expectOne(`${base}r1/`).request.method).toBe('DELETE');
    svc.telecharger('r1').subscribe();
    expect(http.expectOne(`${base}r1/fichier/`).request.responseType).toBe('blob');
  });
});
