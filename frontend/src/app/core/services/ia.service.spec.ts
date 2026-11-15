import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { IaService, messageErreurIa } from './ia.service';
import { environment } from '../../../environments/environment';

const URL = `${environment.apiUrl}/v1/ia/`;

describe('IaService', () => {
  let service: IaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(IaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('le statut est demandé une seule fois par session', () => {
    let a: boolean | undefined;
    let b: boolean | undefined;
    service.disponible$.subscribe(d => (a = d));
    service.disponible$.subscribe(d => (b = d));
    http.expectOne(`${URL}statut/`).flush({ disponible: true, modele: 'claude-opus-5-5' });
    expect([a, b]).toEqual([true, true]);
  });

  it('une erreur de statut vaut « indisponible » (boutons masqués)', () => {
    let d: boolean | undefined;
    service.disponible$.subscribe(v => (d = v));
    http.expectOne(`${URL}statut/`).flush({}, { status: 500, statusText: 'KO' });
    expect(d).toBeFalse();
  });

  it('mappingColonnes() n’envoie que 5 lignes d’exemple', () => {
    const lignes = Array.from({ length: 9 }, (_, i) => [`P${i}`]);
    service.mappingColonnes('ROB', ['Point'], lignes, { point: 'Point' }).subscribe();
    const req = http.expectOne(`${URL}mapping-colonnes/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.lignes.length).toBe(5);
    expect(req.request.body.deja).toEqual({ point: 'Point' });
    req.flush({ propositions: [] });
  });

  it('observations() et synthese() visent le SDGPS', () => {
    service.observations('s1').subscribe();
    expect(http.expectOne(`${URL}observations/`).request.body).toEqual({ ssdgps: 's1' });
    service.synthese('s1').subscribe();
    expect(http.expectOne(`${URL}synthese/`).request.body).toEqual({ ssdgps: 's1' });
  });

  it('assistant() n’envoie que le texte des messages (pas les boutons)', () => {
    service.assistant([
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Oui ?', actions: [{ action: 'a', libelle: 'b', route: 'c' }] },
      { role: 'user', content: 'Mes dossiers' },
    ]).subscribe();
    const req = http.expectOne(`${URL}assistant/`);
    expect(req.request.body.messages).toEqual([
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Oui ?' },
      { role: 'user', content: 'Mes dossiers' },
    ]);
    req.flush({ reponse: 'ok', actions: [], outils: [] });
  });

  it('messageErreurIa()', () => {
    expect(messageErreurIa({ status: 429 })).toContain('Trop de demandes');
    expect(messageErreurIa({ status: 503, error: { detail: 'IA inactive' } })).toBe('IA inactive');
    expect(messageErreurIa({})).toContain('Réessayez');
  });
});
