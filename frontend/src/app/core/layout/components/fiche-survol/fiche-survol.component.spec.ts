import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { FicheSurvolComponent } from './fiche-survol.component';
import { FicheService } from '../../../services/fiche.service';

const FICHE = {
  type: 'ssdgps', libelle_type: 'SDGPS', titre: 'SDGPS n°1', sous_titre: 'PDC/GPS', statut: 'soumis',
  statut_display: 'Soumis', champs: [{ label: 'Nature', valeur: 'PDC/GPS' }],
  compteurs: [{ label: 'Pièces', valeur: 10 }],
  audit: { cree_par: 'Sara Alaoui', cree_le: '01/11/2026 10:00', modifie_par: null, modifie_le: null },
};

describe('FicheSurvolComponent', () => {
  let fixture: ComponentFixture<FicheSurvolComponent>;
  let cmp: FicheSurvolComponent;
  let service: jasmine.SpyObj<FicheService>;

  beforeEach(() => {
    service = jasmine.createSpyObj('FicheService', ['fiche']);
    TestBed.configureTestingModule({
      declarations: [FicheSurvolComponent],
      providers: [{ provide: FicheService, useValue: service }],
    });
    fixture = TestBed.createComponent(FicheSurvolComponent);
    cmp = fixture.componentInstance;
  });

  function cibler(): void {
    fixture.componentRef.setInput('cible', { type: 'ssdgps', id: 's1', rect: { left: 100, bottom: 50, width: 120 } });
    fixture.detectChanges();
  }

  it('rien sans cible', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fs')).toBeNull();
  });

  it('squelette pendant le chargement, puis fiche complète', () => {
    const flux = new Subject<any>();
    service.fiche.and.returnValue(flux);
    cibler();
    expect(service.fiche).toHaveBeenCalledWith('ssdgps', 's1');
    expect(fixture.nativeElement.querySelector('.fs-squelette')).not.toBeNull();
    flux.next(FICHE);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.fs-titre')?.textContent).toContain('SDGPS n°1');
    expect(el.querySelector('.fs-statut')?.classList).toContain('st-info');
    expect(el.querySelector('.fs-compteur .valeur')?.textContent).toBe('10');
    expect(el.querySelector('.fs-champs dd')?.textContent).toBe('PDC/GPS');
    expect(el.querySelector('.fs-audit')?.textContent).toContain('Sara Alaoui');
    expect(el.querySelector('.fs-squelette')).toBeNull();
  });

  it("message sobre en cas d'erreur", () => {
    service.fiche.and.returnValue(throwError(() => new Error('404')));
    cibler();
    expect(fixture.nativeElement.querySelector('.fs-erreur')).not.toBeNull();
  });

  it("positionnée sous le crumb, jamais hors de l'écran", () => {
    cmp.positionner({ left: 100, bottom: 50, width: 120 });
    expect([cmp.gauche, cmp.haut, cmp.flecheGauche]).toEqual([100, 60, 60]);
    cmp.positionner({ left: window.innerWidth - 20, bottom: 50, width: 100 });
    expect(cmp.gauche).toBe(window.innerWidth - 360 - 12);
    cmp.positionner({ left: -40, bottom: 50, width: 100 });
    expect(cmp.gauche).toBe(12);
  });

  it('signale le survol de la fiche (pour la garder ouverte)', () => {
    service.fiche.and.returnValue(of(FICHE as any));
    cibler();
    const vus: boolean[] = [];
    cmp.survolee.subscribe((v: boolean) => vus.push(v));
    const fs: HTMLElement = fixture.nativeElement.querySelector('.fs');
    fs.dispatchEvent(new Event('mouseenter'));
    fs.dispatchEvent(new Event('mouseleave'));
    expect(vus).toEqual([true, false]);
  });

  it('classes de statut', () => {
    expect(cmp.classeStatut('valide')).toBe('st-ok');
    expect(cmp.classeStatut('rejete')).toBe('st-ko');
    expect(cmp.classeStatut('clos')).toBe('st-neutre');
    expect(cmp.classeStatut('en_cours')).toBe('st-cours');
  });
});
