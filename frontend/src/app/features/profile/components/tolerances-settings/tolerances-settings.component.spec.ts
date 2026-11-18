import { fakeAsync, flush, tick } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { TolerancesSettingsComponent, versEdition, versSecondes } from './tolerances-settings.component';
import { differences, TolerancesService } from '../../../../core/services/tolerances.service';
import { environment } from '../../../../../environments/environment';

const DEFAUTS: any = {
  rob_duree: { actif: true, statique_min_s: 1800, statique_limite_acceptee: true, stopgo_min_s: 40, stopgo_limite_acceptee: true },
  rtlb_duree: { actif: true, statique_min_s: 1800, statique_limite_acceptee: true, stopgo_min_s: 40, stopgo_limite_acceptee: false },
  rfb_fermeture: { actif: true },
  ecarts_determinations: { actif: true, max_m: 0.15 },
  rc_ecarts: { actif: true, max_m: 0.15 },
  modes: { statique: ['stati'], stopgo: ['stop', 'go'] },
};
const payload = (effectives = DEFAUTS) => ({ config: {}, effectives: JSON.parse(JSON.stringify(effectives)), defauts: DEFAUTS, libelles: {} });

describe('TolerancesService', () => {
  it('GET / PUT / reset', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(TolerancesService);
    const http = TestBed.inject(HttpTestingController);
    const url = `${environment.apiUrl}/auth/me/tolerances/`;
    svc.get().subscribe();
    expect(http.expectOne(url).request.method).toBe('GET');
    svc.save({ rc_ecarts: { actif: true, max_m: 0.1 } }).subscribe();
    const put = http.expectOne(url);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ rc_ecarts: { actif: true, max_m: 0.1 } });
    svc.reset().subscribe();
    expect(http.expectOne(`${url}reset/`).request.method).toBe('POST');
    http.verify();
  });

  it('differences ne garde que l’écart aux défauts', () => {
    const eff = JSON.parse(JSON.stringify(DEFAUTS));
    eff.rc_ecarts.max_m = 0.1;
    eff.modes.stopgo = ['sg'];
    expect(differences(eff, DEFAUTS)).toEqual({ rc_ecarts: { max_m: 0.1 }, modes: { stopgo: ['sg'] } } as any);
    expect(differences(DEFAUTS, DEFAUTS)).toEqual({});
  });
});

describe('TolerancesSettingsComponent', () => {
  let cmp: TolerancesSettingsComponent;
  let svc: jasmine.SpyObj<any>;

  beforeEach(() => {
    svc = jasmine.createSpyObj('TolerancesService', ['get', 'save', 'reset']);
    svc.get.and.returnValue(of(payload()));
    svc.save.and.callFake(() => of(payload()));
    cmp = new TolerancesSettingsComponent(svc, jasmine.createSpyObj('Toast', ['success', 'error']));
    cmp.ngOnInit();
  });

  it('durées éditées dans l’unité naturelle', () => {
    expect(versEdition(1800)).toEqual({ valeur: 30, unite: 'min' });
    expect(versEdition(40)).toEqual({ valeur: 40, unite: 's' });
    expect(versEdition(7200)).toEqual({ valeur: 2, unite: 'h' });
    expect(versSecondes({ valeur: 1.5, unite: 'h' })).toBe(5400);
    expect(cmp.durees['rob_duree'].statique).toEqual({ valeur: 30, unite: 'min' });
    expect(cmp.defautDuree('rtlb_duree', 'stopgo')).toBe('> 40 s');
  });

  it('enregistre automatiquement uniquement les écarts aux défauts', fakeAsync(() => {
    cmp.durees['rob_duree'].statique = { valeur: 45, unite: 'min' };
    cmp.setCm('rc_ecarts', 10);
    tick(700);
    expect(svc.save).toHaveBeenCalledWith({ rob_duree: { statique_min_s: 2700 }, rc_ecarts: { max_m: 0.1 } });
    expect(cmp.modifie('rc_ecarts')).toBeTrue();
    expect(cmp.modifie('rfb_fermeture')).toBeFalse();
    flush();   // indicateur « enregistré » (2,5 s)
  }));

  it('écart affiché en centimètres', () => {
    expect(cmp.cm('ecarts_determinations')).toBe(15);
  });

  it('mots-clés : rien n’est enregistré si un mode est vide', fakeAsync(() => {
    cmp.motsCles.stopgo = ' , ';
    expect(cmp.motsClesValides).toBeFalse();
    cmp.changed();
    tick(700);
    expect(svc.save).not.toHaveBeenCalled();
    cmp.motsCles.stopgo = 'sg, stop';
    cmp.changed();
    tick(700);
    expect(svc.save.calls.mostRecent().args[0].modes).toEqual({ stopgo: ['sg', 'stop'] });
    flush();
  }));

  it('réinitialisation', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    svc.reset.and.returnValue(of(payload()));
    cmp.reset();
    expect(svc.reset).toHaveBeenCalled();
  });

  it('tout désactiver puis tout activer, seuils conservés', fakeAsync(() => {
    cmp.setCm('rc_ecarts', 10);
    tick(700);
    expect(cmp.regles).toEqual(['rob_duree', 'rtlb_duree', 'rfb_fermeture', 'ecarts_determinations', 'rc_ecarts']);
    expect(cmp.toutesActives).toBeTrue();

    cmp.basculerTout(false);
    expect(cmp.aucuneActive).toBeTrue();
    expect(cmp.nbActives).toBe(0);
    tick(700);
    const off = svc.save.calls.mostRecent().args[0];
    ['rob_duree', 'rtlb_duree', 'rfb_fermeture', 'ecarts_determinations'].forEach(k => expect(off[k]).toEqual({ actif: false }));
    expect(off.rc_ecarts).toEqual({ actif: false, max_m: 0.1 });

    cmp.basculerTout(true);
    expect(cmp.toutesActives).toBeTrue();
    tick(700);
    expect(svc.save.calls.mostRecent().args[0]).toEqual({ rc_ecarts: { max_m: 0.1 } });
    flush();
  }));

  it('les compteurs suivent les interrupteurs individuels', () => {
    cmp.cfg!.rfb_fermeture.actif = false;
    expect(cmp.nbActives).toBe(4);
    expect(cmp.toutesActives).toBeFalse();
    expect(cmp.aucuneActive).toBeFalse();
  });
});

describe('TolerancesSettingsComponent — seuils du contrôle croisé (affichage générique)', () => {
  const DEF: any = { ...DEFAUTS, cc_vecteurs: { actif: true, prec_h_max_m: 0.05, longueur_max_km: 15 }, cc_rc_rdd: { actif: true } };
  const PARAMS: any = { cc_vecteurs: [['prec_h_max_m', 'Précision horizontale maximale', 'cm', 100, 0.5],
                                      ['longueur_max_km', 'Longueur maximale (N5)', 'km', 1, 0.5]],
                        cc_rc_rdd: [] };
  let cmp: TolerancesSettingsComponent;
  let svc: jasmine.SpyObj<any>;

  beforeEach(() => {
    svc = jasmine.createSpyObj('TolerancesService', ['get', 'save', 'reset']);
    svc.get.and.returnValue(of({ config: {}, effectives: JSON.parse(JSON.stringify(DEF)), defauts: DEF, libelles: {}, parametres: PARAMS }));
    svc.save.and.returnValue(of({}));
    cmp = new TolerancesSettingsComponent(svc, jasmine.createSpyObj('Toast', ['success', 'error']));
    cmp.ngOnInit();
  });

  it('affiche chaque seuil dans son unité et enregistre l’écart en unité de base', fakeAsync(() => {
    expect(cmp.reglesControle).toEqual(['cc_vecteurs', 'cc_rc_rdd']);
    const prec = PARAMS.cc_vecteurs[0];
    expect(cmp.valeur('cc_vecteurs', prec)).toBe(5);              // 0,05 m → 5 cm
    expect(cmp.defautParametre('cc_vecteurs', PARAMS.cc_vecteurs[1])).toBe('15 km');
    cmp.setValeur('cc_vecteurs', prec, 2);
    tick(700);
    expect(svc.save).toHaveBeenCalledWith({ cc_vecteurs: { prec_h_max_m: 0.02 } });
    flush();
  }));

  it('les nouvelles règles entrent dans « Tout activer / Tout désactiver »', () => {
    expect(cmp.regles).toContain('cc_rc_rdd');
    cmp.basculerTout(false);
    expect(cmp.cfg!['cc_vecteurs'].actif).toBeFalse();
  });
});
