import { fakeAsync, tick } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { DELAI_RECHERCHE_MS, RechercheGlobaleComponent } from './recherche-globale.component';
import { RechercheService } from '../../../services/recherche.service';
import { environment } from '../../../../../environments/environment';

const R = (id: string, type = 'ssdgps'): any => ({ type, id, titre: id, sous_titre: '', lien: `projets/p1/pieces/${id}` });

describe('RechercheService', () => {
  beforeEach(() => localStorage.removeItem('sdgps.recherche.recents'));

  it('interroge l’API et mémorise les récents sans doublon (6 au plus)', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(RechercheService);
    const http = TestBed.inject(HttpTestingController);
    svc.rechercher('zay').subscribe();
    expect(http.expectOne(r => r.url === `${environment.apiUrl}/v1/recherche/`).request.params.get('q')).toBe('zay');
    for (let i = 0; i < 8; i++) svc.memoriser(R(`s${i}`));
    svc.memoriser(R('s3'));
    expect(svc.recents().length).toBe(6);
    expect(svc.recents()[0].id).toBe('s3');
    svc.oublier();
    expect(svc.recents()).toEqual([]);
    http.verify();
  });
});

describe('RechercheGlobaleComponent', () => {
  let svc: any;
  let router: any;
  let cmp: RechercheGlobaleComponent;

  beforeEach(() => {
    svc = {
      rechercher: jasmine.createSpy('rechercher').and.returnValue(of({ q: 'x', total: 3, groupes: [
        { type: 'ssdgps', libelle: 'SDGPS', resultats: [R('a'), R('b')] },
        { type: 'projet', libelle: 'Projets', resultats: [R('c', 'projet')] }] })),
      recents: jasmine.createSpy('recents').and.returnValue([R('r1')]),
      memoriser: jasmine.createSpy('memoriser'),
      oublier: jasmine.createSpy('oublier'),
    };
    router = { url: '/dashboard', navigateByUrl: jasmine.createSpy('nav') };
    cmp = new RechercheGlobaleComponent(svc, router);
    cmp.ngOnInit();
  });
  afterEach(() => cmp.ngOnDestroy());

  it('Ctrl+K ouvre (avec les récents), Échap ferme', () => {
    cmp.raccourci(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(cmp.ouvert).toBeTrue();
    expect(cmp.elements.map(r => r.id)).toEqual(['r1']);
    cmp.raccourci(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cmp.ouvert).toBeFalse();
  });

  it('frappe différée, pas d’appel sous deux caractères', fakeAsync(() => {
    cmp.q = 'z'; cmp.onFrappe(); tick(DELAI_RECHERCHE_MS);
    expect(svc.rechercher).not.toHaveBeenCalled();
    cmp.q = 'za'; cmp.onFrappe(); cmp.q = 'zay'; cmp.onFrappe(); tick(DELAI_RECHERCHE_MS);
    expect(svc.rechercher).toHaveBeenCalledOnceWith('zay');
    expect(cmp.elements.length).toBe(3);
  }));

  it('flèches + Entrée : ouvre le résultat actif, le mémorise, garde le préfixe admin', fakeAsync(() => {
    router.url = '/admin/projets';
    cmp.ouvrir();
    cmp.q = 'zay'; cmp.onFrappe(); tick(DELAI_RECHERCHE_MS);
    cmp.naviguer(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    cmp.naviguer(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    cmp.naviguer(new KeyboardEvent('keydown', { key: 'ArrowDown' }));   // retour au début
    cmp.naviguer(new KeyboardEvent('keydown', { key: 'ArrowUp' }));     // dernier
    cmp.naviguer(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(svc.memoriser).toHaveBeenCalledWith(R('c', 'projet'));
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/projets/p1/pieces/c');
    expect(cmp.ouvert).toBeFalse();
    tick(DELAI_RECHERCHE_MS);
  }));
});
