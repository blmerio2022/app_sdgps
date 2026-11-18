import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RepriseService, Travail } from '../../../core/services/reprise.service';
import { CLE_MASQUES, ReprendreTravailComponent } from './reprendre-travail.component';

const ssdgps = (id: string, date: string, p: Partial<Travail> = {}): Travail => ({
  type: 'ssdgps', id, date, titre: `SDGPS ${id}`, contexte: 'P-1 · Prop · SD 1', a_faire: '1 pièce à valider',
  lien: `projets/p1/pieces/${id}`, statut: 'en_cours', progression: { validees: 1, total: 2 },
  derniere_piece: { type_piece: 'RDIA', libelle: 'RDIA', statut: 'brouillon', statut_display: 'Brouillon',
                    lien: `projets/p1/pieces/${id}/piece/x` }, ...p,
});

describe('ReprendreTravailComponent', () => {
  let fixture: ComponentFixture<ReprendreTravailComponent>;
  let cmp: ReprendreTravailComponent;
  let router: { url: string; navigateByUrl: jasmine.Spy };
  let svc: { travaux: jasmine.Spy };

  function creer(reponse: any, url = '/dashboard'): HTMLElement {
    router = { url, navigateByUrl: jasmine.createSpy('navigateByUrl') };
    svc = { travaux: jasmine.createSpy('travaux').and.returnValue(reponse) };
    TestBed.configureTestingModule({
      declarations: [ReprendreTravailComponent],
      providers: [{ provide: RepriseService, useValue: svc }, { provide: Router, useValue: router }],
    });
    fixture = TestBed.createComponent(ReprendreTravailComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => localStorage.removeItem(CLE_MASQUES));
  afterEach(() => localStorage.removeItem(CLE_MASQUES));

  it('met le dernier travail en vedette, puis les autres', () => {
    const el = creer(of({ total: 2, resultats: [ssdgps('a', '2026-11-18T10:00:00Z'), ssdgps('b', '2026-11-10T10:00:00Z')] }));
    expect(el.querySelector('.rt-vedette h3')?.textContent).toContain('SDGPS a');
    expect(el.querySelectorAll('.rt-ligne').length).toBe(1);
    expect(el.textContent).toContain('1 pièce à valider');
    expect(el.textContent).toContain('1/2 validées');
    expect(el.textContent).toContain('Dernière pièce : RDIA');
    expect(el.textContent).toContain('2 en cours');
  });

  it('continuer ouvre le lien dans la zone courante (opérateur ou admin)', () => {
    creer(of({ total: 1, resultats: [ssdgps('a', '2026-11-18T10:00:00Z')] }));
    cmp.continuer(cmp.vedette!);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/projets/p1/pieces/a');
    router.url = '/admin/dashboard';
    cmp.ouvrirPiece(cmp.vedette!);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/projets/p1/pieces/a/piece/x');
  });

  it('masquer cache le travail jusqu’à sa prochaine activité', () => {
    creer(of({ total: 2, resultats: [ssdgps('a', '2026-11-18T10:00:00Z'), ssdgps('b', '2026-11-10T10:00:00Z')] }));
    cmp.masquer(cmp.vedette!);
    expect(cmp.vedette!.id).toBe('b');
    expect(cmp.nbMasques).toBe(1);
    // Nouvelle activité sur « a » : il réapparaît.
    cmp.travaux = [ssdgps('a', '2026-11-18T11:00:00Z'), ssdgps('b', '2026-11-10T10:00:00Z')];
    expect(cmp.vedette!.id).toBe('a');
  });

  it('« Afficher plus » au-delà de la vedette + 5 lignes', () => {
    const liste = Array.from({ length: 9 }, (_, i) => ssdgps(`s${i}`, `2026-11-${10 + i}T10:00:00Z`));
    creer(of({ total: 9, resultats: liste }));
    expect(cmp.autres.length).toBe(5);
    expect(cmp.restants).toBe(3);
    cmp.tousAffiches = true;
    expect(cmp.autres.length).toBe(8);
    expect(cmp.libelleType(liste[0])).toBe('');                         // le titre dit déjà « SDGPS »
    expect(cmp.libelleType({ ...liste[0], session: { numero: 2 } })).toBe('Session n°2 ·');
    expect(cmp.libelleType({ ...liste[0], type: 'affaire' })).toBe('Affaire ·');
  });

  it('tons : renvoi / échec en alerte, tout validé « prêt »', () => {
    creer(of({ total: 0, resultats: [] }));
    expect(cmp.ton(ssdgps('a', '', { renvoye: true }))).toBe('alerte');
    expect(cmp.ton({ ...ssdgps('a', ''), type: 'rapport', statut: 'echec' })).toBe('alerte');
    expect(cmp.ton(ssdgps('a', '', { progression: { validees: 3, total: 3 } }))).toBe('pret');
    expect(cmp.pourcent({ ...ssdgps('a', ''), type: 'rapport', progression_pct: 40 })).toBe(40);
  });

  it('état vide et erreur', () => {
    let el = creer(of({ total: 0, resultats: [] }));
    expect(el.textContent).toContain('Tout est à jour');
    TestBed.resetTestingModule();
    el = creer(throwError(() => ({ status: 500 })));
    expect(el.textContent).toContain('Impossible de retrouver vos travaux');
  });
});
