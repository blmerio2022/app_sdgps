import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { NotificationsService, apparenceNotification, ilYa } from './notifications.service';
import { environment } from '../../../environments/environment';

const URL = `${environment.apiUrl}/v1/notifications/`;

describe('NotificationsService', () => {
  let svc: NotificationsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(NotificationsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('liste paginée, filtre non lues, met à jour le compteur partagé', () => {
    svc.liste(2, true).subscribe();
    const req = http.expectOne(r => r.url === URL);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('non_lues')).toBe('1');
    req.flush({ count: 0, next: null, previous: null, results: [], non_lues: 4 });
    expect(svc.nonLues$.value).toBe(4);
  });

  it('compte, marquer, tout lu, supprimer, vider, préférences', () => {
    svc.compte().subscribe();
    http.expectOne(`${URL}compte/`).flush({ non_lues: 3 });
    expect(svc.nonLues$.value).toBe(3);
    svc.marquer(7).subscribe();
    const m = http.expectOne(`${URL}7/lue/`);
    expect(m.request.body).toEqual({ lue: true });
    m.flush({});
    expect(svc.nonLues$.value).toBe(2);
    svc.toutLu().subscribe();
    http.expectOne(`${URL}tout-lu/`).flush({ marquees: 2 });
    expect(svc.nonLues$.value).toBe(0);
    svc.supprimer(7).subscribe();
    expect(http.expectOne(`${URL}7/`).request.method).toBe('DELETE');
    svc.viderLues().subscribe();
    http.expectOne(`${URL}vider/`).flush({ supprimees: 1 });
    svc.enregistrerPreferences({ types: { RAPPORT_PRET: true } }).subscribe();
    const p = http.expectOne(`${URL}preferences/`);
    expect(p.request.method).toBe('PUT');
    p.flush({ emails_actifs: true, types: [] });
  });

  it('apparence et date relative', () => {
    expect(apparenceNotification('DOSSIER_REJETE').famille).toBe('alerte');
    expect(apparenceNotification('INCONNU').icone).toBe('fa-bell');
    const maintenant = new Date('2026-11-15T12:00:00Z');
    expect(ilYa('2026-11-15T11:59:30Z', maintenant)).toBe("à l'instant");
    expect(ilYa('2026-11-15T11:50:00Z', maintenant)).toBe('il y a 10 min');
    expect(ilYa('2026-11-14T10:00:00Z', maintenant)).toBe('hier');
  });
});
