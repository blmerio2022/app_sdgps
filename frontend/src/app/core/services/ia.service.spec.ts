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

describe('IaService (discussions, observations, configuration)', () => {
  let service: IaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(IaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('discussions : liste filtrée, création, lecture, modification, suppression', () => {
    service.conversations(' zaytoun ', 'archivees').subscribe();
    const liste = http.expectOne(r => r.url === `${URL}conversations/`);
    expect(liste.request.params.get('q')).toBe('zaytoun');
    expect(liste.request.params.get('etat')).toBe('archivees');
    liste.flush([]);
    service.creerConversation('A').subscribe();
    expect(http.expectOne(`${URL}conversations/`).request.body).toEqual({ titre: 'A' });
    service.conversation('c1').subscribe();
    http.expectOne(`${URL}conversations/c1/`).flush({});
    service.modifierConversation('c1', { archivee: true }).subscribe();
    const patch = http.expectOne(`${URL}conversations/c1/`);
    expect([patch.request.method, patch.request.body]).toEqual(['PATCH', { archivee: true }]);
    patch.flush({});
    service.supprimerConversation('c1').subscribe();
    expect(http.expectOne(`${URL}conversations/c1/`).request.method).toBe('DELETE');
  });

  it('discussions : message, régénération, export', () => {
    service.envoyerMessage('c1', 'Bonjour').subscribe();
    expect(http.expectOne(`${URL}conversations/c1/messages/`).request.body).toEqual({ contenu: 'Bonjour' });
    service.regenerer('c1').subscribe();
    expect(http.expectOne(`${URL}conversations/c1/regenerer/`).request.method).toBe('POST');
    service.exporter('c1').subscribe();
    http.expectOne(`${URL}conversations/c1/export/`).flush({ nom_fichier: 'a.md', contenu: '#' });
  });

  it('observations : rédaction ciblée et guidée, application, suppression, historique, restauration', () => {
    service.observations('s1', { pieces: ['p1'], consigne: ' bref ', consignes: { p1: 'projection', p2: '  ' } }).subscribe();
    expect(http.expectOne(`${URL}observations/`).request.body)
      .toEqual({ ssdgps: 's1', pieces: ['p1'], consigne: 'bref', consignes: { p1: 'projection' } });
    service.appliquerObservations('s1', [{ piece: 'p1', texte: 'x' }]).subscribe();
    expect(http.expectOne(`${URL}observations/appliquer/`).request.body.observations.length).toBe(1);
    service.supprimerObservations('s1', 'toutes').subscribe();
    expect(http.expectOne(`${URL}observations/supprimer/`).request.body).toEqual({ ssdgps: 's1', toutes: true });
    service.supprimerObservations('s1', ['p1']).subscribe();
    expect(http.expectOne(`${URL}observations/supprimer/`).request.body).toEqual({ ssdgps: 's1', pieces: ['p1'] });
    service.historiqueObservations('s1', 'p1').subscribe();
    const h = http.expectOne(r => r.url === `${URL}observations/historique/`);
    expect(h.request.params.get('piece')).toBe('p1');
    h.flush([]);
    service.restaurerObservation(7).subscribe();
    expect(http.expectOne(`${URL}observations/restaurer/`).request.body).toEqual({ archive: 7 });
  });

  it('configuration : lecture, enregistrement (statut relu ensuite), test, modèles, préférences', () => {
    service.statut().subscribe();
    http.expectOne(`${URL}statut/`).flush({ disponible: false, modele: null });
    service.configuration().subscribe();
    http.expectOne(`${URL}config/`).flush({});
    service.enregistrerConfiguration({ fournisseur: 'openrouter', cle: 'sk' }).subscribe();
    const put = http.expectOne(`${URL}config/`);
    expect(put.request.method).toBe('PUT');
    put.flush({});
    service.statut().subscribe();                                  // relu après changement
    http.expectOne(`${URL}statut/`).flush({ disponible: true, modele: 'm' });
    service.testerConfiguration().subscribe();
    http.expectOne(`${URL}config/tester/`).flush({ ok: true, essais: [] });
    service.modeles(':free').subscribe();
    expect(http.expectOne(r => r.url === `${URL}modeles/`).request.params.get('filtre')).toBe(':free');
    service.enregistrerPreferences('m').subscribe();
    expect(http.expectOne(`${URL}preferences/`).request.body).toEqual({ modele_assistant: 'm' });
  });

  it('messageErreurIa() : réservé à l’administration', () => {
    expect(messageErreurIa({ status: 403 })).toContain('administration');
  });
});
