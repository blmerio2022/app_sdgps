import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { StockageService } from '../../../core/services/stockage.service';
import { StockageSettingsComponent, niveauStockage } from './stockage-settings.component';

const etat = (p: Partial<any> = {}) => ({
  organization_id: 'o1', organization_name: 'Cadastre Azilal', quota_bytes: 1000, effective_quota_bytes: 1000,
  used_bytes: 500, remaining_bytes: 500, usage_percent: 50, is_unlimited: false, is_exceeded: false, ...p,
});

describe('StockageSettingsComponent', () => {
  let fixture: ComponentFixture<StockageSettingsComponent>;
  let svc: { monStockage: jasmine.Spy };

  function creer(reponse: any): HTMLElement {
    svc = { monStockage: jasmine.createSpy('monStockage').and.returnValue(reponse) };
    TestBed.configureTestingModule({
      declarations: [StockageSettingsComponent],
      providers: [{ provide: StockageService, useValue: svc }],
    });
    fixture = TestBed.createComponent(StockageSettingsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('affiche organisation, place restante, plafond, part et projets', () => {
    const el = creer(of({ organisation: etat(), ma_part_bytes: 250,
      mes_projets: [{ id: 'p1', code: 'P-1', nom: 'Projet', bytes: 250 }] }));
    expect(el.textContent).toContain('Cadastre Azilal');
    expect(el.textContent).toContain('500 octets disponibles');
    expect(el.textContent).toContain('Espace suffisant');
    expect(el.textContent).toContain('(50 %)');
    expect(fixture.componentInstance.pourcent(94.34)).toBe('94,3 %');
    expect(el.textContent).toContain('50 %');
    expect(el.textContent).toContain('P-1');
    expect(el.querySelector('.st-jauge span')?.getAttribute('style')).toContain('width: 50%');
  });

  it('quota dépassé : explique que les imports sont refusés', () => {
    const el = creer(of({ organisation: etat({ used_bytes: 1200, remaining_bytes: 0, usage_percent: 120, is_exceeded: true }),
      ma_part_bytes: 0, mes_projets: [] }));
    expect(el.textContent).toContain('Quota dépassé');
    expect(el.textContent).toContain('sont refusés');
    expect(fixture.componentInstance.largeur).toBe(100);
  });

  it('illimité : ni jauge ni conseils', () => {
    const el = creer(of({ organisation: etat({ is_unlimited: true, effective_quota_bytes: 0, remaining_bytes: null, usage_percent: null }),
      ma_part_bytes: 0, mes_projets: [] }));
    expect(el.textContent).toContain('Espace illimité');
    expect(el.querySelector('.st-jauge')).toBeNull();
    expect(el.querySelector('.st-conseils')).toBeNull();
  });

  it('sans organisation : aucun quota', () => {
    const el = creer(of({ organisation: null, ma_part_bytes: 0, mes_projets: [] }));
    expect(el.textContent).toContain('aucune organisation');
  });

  it('erreur de lecture affichée', () => {
    const el = creer(throwError(() => ({ error: { detail: 'Serveur indisponible' } })));
    expect(el.textContent).toContain('Serveur indisponible');
  });

  it('niveaux d’occupation', () => {
    expect(niveauStockage(null)).toBe('illimite');
    expect(niveauStockage(etat({ usage_percent: 80 }) as any)).toBe('attention');
    expect(niveauStockage(etat({ usage_percent: 95 }) as any)).toBe('critique');
    expect(niveauStockage(etat({ is_exceeded: true }) as any)).toBe('plein');
  });
});
