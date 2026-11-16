import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { SauvegardesComponent, SauvegardesService, taille } from './sauvegardes.component';
import { environment } from '../../../../environments/environment';

const S: any = { nom: 'sdgps-development-20261116-020000.zip', taille: 2048, date: '2026-11-16T02:00:00Z', avec_medias: false, securite: false };
const ETAT: any = { sauvegardes: [S], derniere: S, en_retard: false, alerte_heures: 36, retention: 14,
                    environnement: 'development', super_admin: true };

describe('SauvegardesService', () => {
  it('routes', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(SauvegardesService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${environment.apiUrl}/v1/platform-admin/sauvegardes/`;
    svc.creer(true).subscribe();
    expect(http.expectOne(base).request.body).toEqual({ avec_medias: true });
    svc.restaurer(S.nom, 'development').subscribe();
    expect(http.expectOne(`${base}${S.nom}/restaurer/`).request.body).toEqual({ confirmation: 'development' });
    svc.telecharger(S.nom).subscribe();
    expect(http.expectOne(`${base}${S.nom}/`).request.responseType).toBe('blob');
    http.verify();
  });
});

describe('SauvegardesComponent', () => {
  let svc: any;
  let toast: any;
  let cmp: SauvegardesComponent;

  beforeEach(() => {
    svc = {
      etat: jasmine.createSpy('etat').and.returnValue(of(ETAT)),
      creer: jasmine.createSpy('creer').and.returnValue(of({ nom: 'x.zip', objets: 10 })),
      telecharger: jasmine.createSpy('tel').and.returnValue(of(new HttpResponse({ body: new Blob(['PK']) }))),
      supprimer: jasmine.createSpy('sup').and.returnValue(of(null)),
      restaurer: jasmine.createSpy('rest').and.returnValue(of({ sauvegarde_securite: 'y-securite.zip' })),
    };
    toast = jasmine.createSpyObj('Toast', ['success', 'error']);
    cmp = new SauvegardesComponent(svc, toast);
    cmp.ngOnInit();
  });

  it('crée une sauvegarde puis recharge', () => {
    cmp.avecMedias = true;
    cmp.creer();
    expect(svc.creer).toHaveBeenCalledWith(true);
    expect(svc.etat).toHaveBeenCalledTimes(2);
  });

  it('restauration : exige le nom exact de l’environnement', () => {
    cmp.demanderRestauration(S);
    cmp.confirmation = 'production';
    expect(cmp.confirmationValide).toBeFalse();
    cmp.restaurer();
    expect(svc.restaurer).not.toHaveBeenCalled();
    cmp.confirmation = 'development';
    cmp.restaurer();
    expect(svc.restaurer).toHaveBeenCalledWith(S.nom, 'development');
    expect(cmp.aRestaurer).toBeNull();
  });

  it('téléchargement, suppression confirmée, 403', () => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.telecharger(S);
    expect(svc.telecharger).toHaveBeenCalledWith(S.nom);
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.supprimer(S);
    expect(svc.supprimer).toHaveBeenCalledWith(S.nom);
    svc.etat.and.returnValue(throwError(() => ({ status: 403 })));
    cmp.charger();
    expect(cmp.erreur).toContain('Réservé');
    expect(taille(3 * 1024 * 1024)).toBe('3.0 Mo');
  });
});
