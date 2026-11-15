import { fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { NotificationBellComponent, SONDAGE_NOTIFICATIONS_MS } from './notification-bell.component';

const N = (id: number, lue = false, lien = 'projets/p1/pieces/s1'): any => ({
  id, type: 'DOSSIER_REJETE', type_display: 'Dossier rejeté', titre: `T${id}`, message: 'm', lien,
  cible_type: 'ssdgps', cible_id: 's1', acteur_nom: 'Admin', lue, lue_le: null, created_at: '2026-11-15T10:00:00Z',
});

describe('NotificationBellComponent', () => {
  let svc: any;
  let router: any;
  let cmp: NotificationBellComponent;

  beforeEach(() => {
    localStorage.setItem('authToken', 'x');
    svc = {
      nonLues$: new BehaviorSubject(2),
      compte: jasmine.createSpy('compte').and.returnValue(of({ non_lues: 2 })),
      liste: jasmine.createSpy('liste').and.returnValue(of({ count: 2, next: 'p2', previous: null, results: [N(1), N(2, true)], non_lues: 1 })),
      marquer: jasmine.createSpy('marquer').and.callFake((id: number, lue: boolean) => of({ ...N(id), lue })),
      supprimer: jasmine.createSpy('supprimer').and.returnValue(of(null)),
      toutLu: jasmine.createSpy('toutLu').and.returnValue(of({ marquees: 1 })),
      viderLues: jasmine.createSpy('viderLues').and.returnValue(of({ supprimees: 1 })),
    };
    router = { url: '/dashboard', navigateByUrl: jasmine.createSpy('navigateByUrl') };
    cmp = new NotificationBellComponent(svc, router);
  });

  afterEach(() => { cmp.ngOnDestroy(); localStorage.removeItem('authToken'); });

  it('sonde le compteur au démarrage puis périodiquement', fakeAsync(() => {
    cmp.ngOnInit();
    expect(svc.compte).toHaveBeenCalledTimes(1);
    tick(SONDAGE_NOTIFICATIONS_MS);
    expect(svc.compte).toHaveBeenCalledTimes(2);
    expect(cmp.badge).toBe('2');
    discardPeriodicTasks();
  }));

  it('ne sonde pas sans session', () => {
    localStorage.removeItem('authToken');
    cmp.rafraichirCompte();
    expect(svc.compte).not.toHaveBeenCalled();
  });

  it('ouvrir le panneau charge la liste, « afficher plus » ajoute la page suivante', () => {
    cmp.basculer();
    expect(svc.liste).toHaveBeenCalledWith(1, false);
    expect(cmp.notifications.length).toBe(2);
    expect(cmp.plus).toBeTrue();
    cmp.charger(2);
    expect(cmp.notifications.length).toBe(4);
  });

  it('clic : marque lue et ouvre le dossier (préfixe /admin conservé)', () => {
    router.url = '/admin/dashboard';
    const n = N(1);
    cmp.ouvrir(n);
    expect(svc.marquer).toHaveBeenCalledWith(1, true);
    expect(n.lue).toBeTrue();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/projets/p1/pieces/s1');
  });

  it('supprimer, tout lu, effacer les lues', () => {
    cmp.ngOnInit();
    cmp.basculer();
    const ev = new Event('click');
    cmp.supprimer(cmp.notifications[0], ev);
    expect(cmp.notifications.map(n => n.id)).toEqual([2]);
    expect(svc.nonLues$.value).toBe(1);
    cmp.notifications = [N(3), N(4, true)];
    cmp.toutLu();
    expect(cmp.notifications.every(n => n.lue)).toBeTrue();
    cmp.viderLues();
    expect(cmp.notifications).toEqual([]);
  });

  it('badge plafonné à 99+', () => {
    cmp.nonLues = 150;
    expect(cmp.badge).toBe('99+');
  });
});
