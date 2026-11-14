import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { NouvelleVersionBannerComponent } from './nouvelle-version-banner.component';
import { VersionBadgeComponent } from './version-badge.component';
import { VersionModule } from './version.module';
import {
  estNouvelle, INTERVALLE_SONDAGE_MS, libelleEnvironnement, VersionInfo, VersionService,
} from './version.service';

const URL = `${environment.apiUrl}/version/`;
const info = (version: string, environnement = 'staging'): VersionInfo => ({
  version, commit: 'e7d0fc1', date_commit: '2026-11-14T17:26:30Z',
  date_build: '2026-11-14T18:00:00+00:00', environnement,
});

describe('version : règles', () => {
  it('nouvelle version = version en ligne différente du bundle', () => {
    expect(estNouvelle('v1.0.33', 'v1.0.34')).toBeTrue();
    expect(estNouvelle('v1.0.34', 'v1.0.34')).toBeFalse();
  });

  it('jamais en développement ni avec une version inconnue', () => {
    expect(estNouvelle('dev', 'v1.0.34')).toBeFalse();
    expect(estNouvelle('v1.0.33', 'inconnue')).toBeFalse();
    expect(estNouvelle('inconnue', 'v1.0.34')).toBeFalse();
    expect(estNouvelle('v1.0.33', null)).toBeFalse();
  });

  it('libellé d’environnement (production masquée)', () => {
    expect(libelleEnvironnement('staging')).toBe('staging');
    expect(libelleEnvironnement('development')).toBe('dev');
    expect(libelleEnvironnement('preprod')).toBe('préprod');
    expect(libelleEnvironnement('production')).toBe('');
    expect(libelleEnvironnement(undefined)).toBe('');
  });
});

describe('VersionService', () => {
  let svc: VersionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(VersionService);
    http = TestBed.inject(HttpTestingController);
    (svc as any).bundle = { version: 'v1.0.33', commit: 'aaa' };
  });

  afterEach(() => { svc.ngOnDestroy(); http.verify(); });

  it('charge la version publique et signale une version plus récente', () => {
    const vues: (string | null)[] = [];
    svc.nouvelleVersion$.subscribe(v => vues.push(v));
    svc.rafraichir();
    http.expectOne(URL).flush(info('v1.0.34'));
    expect(vues).toEqual([null, 'v1.0.34']);
  });

  it('même version : pas de bandeau', () => {
    let derniere: string | null = 'x';
    svc.nouvelleVersion$.subscribe(v => (derniere = v));
    svc.rafraichir();
    http.expectOne(URL).flush(info('v1.0.33'));
    expect(derniere).toBeNull();
  });

  it('API injoignable : rien ne casse, dernière valeur conservée', () => {
    svc.rafraichir();
    http.expectOne(URL).flush(info('v1.0.33'));
    svc.rafraichir();
    http.expectOne(URL).flush('ko', { status: 502, statusText: 'Bad Gateway' });
    let courante: VersionInfo | null = null;
    svc.info$.subscribe(i => (courante = i));
    expect(courante!.version).toBe('v1.0.33');
  });

  it('sonde immédiatement puis périodiquement, une seule fois même si relancé', fakeAsync(() => {
    svc.demarrer();
    svc.demarrer();
    tick(0);
    http.expectOne(URL).flush(info('v1.0.33'));
    tick(INTERVALLE_SONDAGE_MS);
    http.expectOne(URL).flush(info('v1.0.34'));
    discardPeriodicTasks();
  }));

  it('vérifie au retour sur l’onglet', () => {
    svc.demarrer();
    http.match(URL).forEach(r => r.flush(info('v1.0.33')));
    document.dispatchEvent(new Event('visibilitychange'));
    // visibilityState vaut « visible » dans le navigateur de test.
    http.expectOne(URL).flush(info('v1.0.33'));
  });
});

describe('Composants de version', () => {
  let svc: VersionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VersionModule, HttpClientTestingModule] });
    svc = TestBed.inject(VersionService);
    http = TestBed.inject(HttpTestingController);
    (svc as any).bundle = { version: 'v1.0.33', commit: 'aaa' };
  });

  function charger(version: string, env = 'staging'): void {
    svc.rafraichir();
    http.expectOne(URL).flush(info(version, env));
  }

  it('badge : version et environnement, rien avant le chargement', () => {
    const f: ComponentFixture<VersionBadgeComponent> = TestBed.createComponent(VersionBadgeComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent.trim()).toBe('');
    charger('v1.0.34');
    f.detectChanges();
    const texte = f.nativeElement.querySelector('.vb-trigger').textContent;
    expect(texte).toContain('SDGPS');
    expect(texte).toContain('v1.0.34');
    expect(texte).toContain('staging');
  });

  it('badge compact : numéro seul ; production sans pastille', () => {
    const f = TestBed.createComponent(VersionBadgeComponent);
    f.componentInstance.compact = true;
    charger('v1.0.34', 'production');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.vb-trigger').textContent.trim()).toBe('1.0.34');
    expect(f.nativeElement.querySelector('.vb-env')).toBeNull();
  });

  it('« À propos » : commit, version de la page et rappel de recharger', () => {
    const f = TestBed.createComponent(VersionBadgeComponent);
    charger('v1.0.34');
    f.detectChanges();
    f.nativeElement.querySelector('.vb-trigger').click();
    f.detectChanges();
    const modale = f.nativeElement.querySelector('.vb-modal').textContent;
    expect(modale).toContain('e7d0fc1');
    expect(modale).toContain('v1.0.33');
    expect(modale).toContain('ancienne version');
    f.componentInstance.onEscape();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.vb-modal')).toBeNull();
  });

  it('bandeau : affiché si nouvelle version, « Plus tard » le masque pour cette version seulement', () => {
    const f = TestBed.createComponent(NouvelleVersionBannerComponent);
    charger('v1.0.33');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.nv-banner')).toBeNull();

    charger('v1.0.34');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.nv-banner').textContent).toContain('v1.0.34');

    f.nativeElement.querySelector('.nv-later').click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.nv-banner')).toBeNull();

    charger('v1.0.35');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.nv-banner')).not.toBeNull();
  });

  it('bandeau : « Recharger » recharge la page', () => {
    const f = TestBed.createComponent(NouvelleVersionBannerComponent);
    spyOn(svc, 'recharger');
    charger('v1.0.34');
    f.detectChanges();
    f.nativeElement.querySelector('.nv-reload').click();
    expect(svc.recharger).toHaveBeenCalled();
  });
});
