import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { CarteDossiersService, DossierCarte } from '../../core/services/carte-dossiers.service';
import { CarteDossiersPageComponent, echapper } from './carte-dossiers-page.component';

const D = (id: string, statut: string, p: Partial<DossierCarte> = {}): DossierCarte => ({
  id, titre: `SDGPS ${id}`, nature: 'PDC/GPS', statut, statut_display: statut, contexte: 'P-1 · Azilal',
  lat: 31.96, lon: -6.99, nb_points: 15, source: 'LPA', zone: 'nord', zone_supposee: false,
  lien: `projets/p/pieces/${id}`, ...p,
});

describe('CarteDossiersPageComponent', () => {
  let fixture: ComponentFixture<CarteDossiersPageComponent>;
  let cmp: CarteDossiersPageComponent;
  let router: { url: string; navigateByUrl: jasmine.Spy };

  beforeEach(() => {
    router = { url: '/carte', navigateByUrl: jasmine.createSpy('navigateByUrl') };
    TestBed.configureTestingModule({
      declarations: [CarteDossiersPageComponent], imports: [FormsModule],
      providers: [
        { provide: CarteDossiersService, useValue: { charger: () => of({ dossiers: [D('a', 'en_cours'), D('b', 'valide', { lat: 30.4, lon: -9.6 })], sans_position: 3, total: 5 }) } },
        { provide: Router, useValue: router },
      ],
    });
    fixture = TestBed.createComponent(CarteDossiersPageComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('place les dossiers et annonce ceux sans position', () => {
    expect(fixture.nativeElement.querySelectorAll('.leaflet-interactive').length).toBe(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('3 sans position');
  });

  it('filtre par statut et par texte', () => {
    cmp.basculerStatut('valide');
    expect(cmp.visibles.map(d => d.id)).toEqual(['a']);
    expect(fixture.nativeElement.querySelectorAll('.leaflet-interactive').length).toBe(1);
    cmp.basculerStatut('valide');
    cmp.recherche = 'sdgps b';
    expect(cmp.visibles.map(d => d.id)).toEqual(['b']);
    expect(cmp.compte('en_cours')).toBe(1);
  });

  it('ouvre un dossier dans la zone courante', () => {
    cmp.ouvrir(D('a', 'en_cours'));
    expect(router.navigateByUrl).toHaveBeenCalledWith('/projets/p/pieces/a');
    router.url = '/admin/carte';
    cmp.ouvrir(D('a', 'en_cours'));
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/projets/p/pieces/a');
  });

  it('échappe le texte des infobulles', () => {
    expect(echapper('<b>"A&B"</b>')).toBe('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
  });
});
