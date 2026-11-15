import { TestBed } from '@angular/core/testing';
import { HttpParams } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { CachetsSignaturesService, withCachetParams } from './cachets-signatures.service';
import { PARAMETRES_DEFAUT } from '../models/cachet-signature.model';
import { environment } from '../../../environments/environment';

const URL = `${environment.apiUrl}/v1/cachets-signatures/`;

describe('CachetsSignaturesService', () => {
  let service: CachetsSignaturesService;
  let http: HttpTestingController;
  const image = new Blob(['x'], { type: 'image/jpeg' });

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(CachetsSignaturesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() accepte une liste ou une réponse paginée', () => {
    let a: any[] = [];
    let b: any[] = [];
    service.list().subscribe(l => (a = l));
    http.expectOne(URL).flush([{ id: '1' }]);
    service.list().subscribe(l => (b = l));
    http.expectOne(URL).flush({ results: [{ id: '2' }, { id: '3' }] });
    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
  });

  it('apercu() envoie l\'image et les paramètres en multipart, sans rien enregistrer', () => {
    service.apercu(image, { ...PARAMETRES_DEFAUT, couleur: 'bleu' }).subscribe();
    const req = http.expectOne(`${URL}apercu/`);
    expect(req.request.method).toBe('POST');
    const form = req.request.body as FormData;
    expect(form.get('fichier')).toBeTruthy();
    expect(JSON.parse(form.get('parametres') as string).couleur).toBe('bleu');
    req.flush({});
  });

  it('create() transmet nom, paramètres et défaut', () => {
    service.create(image, 'Cabinet', PARAMETRES_DEFAUT, true).subscribe();
    const req = http.expectOne(URL);
    const form = req.request.body as FormData;
    expect(req.request.method).toBe('POST');
    expect(form.get('nom')).toBe('Cabinet');
    expect(form.get('par_defaut')).toBe('true');
    req.flush({});
  });

  it('update() en JSON, replaceImage() en multipart', () => {
    service.update('c1', { nom: 'B', par_defaut: true }).subscribe();
    const a = http.expectOne(`${URL}c1/`);
    expect(a.request.method).toBe('PATCH');
    expect(a.request.body).toEqual({ nom: 'B', par_defaut: true });
    a.flush({});

    service.replaceImage('c1', image, PARAMETRES_DEFAUT, { nom: 'C' }).subscribe();
    const b = http.expectOne(`${URL}c1/`);
    expect(b.request.body instanceof FormData).toBeTrue();
    expect((b.request.body as FormData).get('nom')).toBe('C');
    b.flush({});
  });

  it('delete() et originale()', () => {
    service.delete('c1').subscribe();
    expect(http.expectOne(`${URL}c1/`).request.method).toBe('DELETE');
    let src = '';
    service.originale('c1').subscribe(s => (src = s));
    http.expectOne(`${URL}c1/originale/`).flush({ image: 'data:image/jpeg;base64,AA' });
    expect(src).toBe('data:image/jpeg;base64,AA');
  });

  it('withCachetParams() n\'ajoute rien sans cachet', () => {
    const p = withCachetParams(new HttpParams().set('ssdgps', 's'), null);
    expect(p.keys()).toEqual(['ssdgps']);
    const q = withCachetParams(new HttpParams(),
      { cachetId: 'c', position: 'bas-gauche', taille: 30, pages: 'toutes' });
    expect(q.get('cachet_taille')).toBe('30');
    expect(q.get('cachet_position')).toBe('bas-gauche');
  });
});
