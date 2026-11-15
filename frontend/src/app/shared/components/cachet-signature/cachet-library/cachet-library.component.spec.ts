import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { CachetLibraryComponent } from './cachet-library.component';
import { CachetSignature } from '../../../../core/models/cachet-signature.model';
import { environment } from '../../../../../environments/environment';

const URL = `${environment.apiUrl}/v1/cachets-signatures/`;

function cachet(id: string, defaut = false, updated = '2026-01-01'): CachetSignature {
  return { id, nom: id, image: 'data:image/png;base64,AA', parametres: {}, largeur_px: 10, hauteur_px: 10,
           par_defaut: defaut, derniere_utilisation: null, created_at: updated, updated_at: updated };
}

describe('CachetLibraryComponent', () => {
  let fixture: ComponentFixture<CachetLibraryComponent>;
  let comp: CachetLibraryComponent;
  let http: HttpTestingController;
  let emis: CachetSignature[][];
  const ev = new Event('click');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      declarations: [CachetLibraryComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(CachetLibraryComponent);
    comp = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    emis = [];
    comp.cachetsChange.subscribe(l => emis.push(l));
  });

  afterEach(() => http.verify());

  function charger(liste: CachetSignature[]) {
    fixture.detectChanges();
    http.expectOne(URL).flush(liste);
  }

  it('charge la bibliothèque, le défaut en tête, et la publie', () => {
    charger([cachet('a', false, '2026-03-01'), cachet('b', true, '2026-01-01')]);
    expect(comp.cachets.map(c => c.id)).toEqual(['b', 'a']);
    expect(emis.length).toBe(1);
  });

  it('en mode « choisir », un clic sélectionne ; en mode « gérer », non', () => {
    charger([cachet('a')]);
    let choisi: string | null = null;
    comp.selectedIdChange.subscribe(id => (choisi = id));
    comp.choisir(comp.cachets[0]);
    expect(choisi).toBeNull();
    comp.mode = 'choisir';
    comp.choisir(comp.cachets[0]);
    expect(choisi as any).toBe('a');
  });

  it('définir par défaut retire le défaut des autres', () => {
    charger([cachet('a', true), cachet('b')]);
    comp.definirDefaut(comp.cachets.find(c => c.id === 'b')!, ev);
    const req = http.expectOne(`${URL}b/`);
    expect(req.request.body).toEqual({ par_defaut: true });
    req.flush({});
    expect(comp.cachets.filter(c => c.par_defaut).map(c => c.id)).toEqual(['b']);
  });

  it('suppression avec confirmation ; le défaut et la sélection passent au suivant', () => {
    charger([cachet('a', true), cachet('b', false, '2026-05-01')]);
    comp.mode = 'choisir';
    comp.selectedId = 'a';
    let choisi: string | null = 'a';
    comp.selectedIdChange.subscribe(id => (choisi = id));

    const a = comp.cachets.find(c => c.id === 'a')!;
    comp.demanderSuppression(a, ev);
    expect(comp.aSupprimer).toBe('a');
    comp.confirmerSuppression(a, ev);
    http.expectOne(`${URL}a/`).flush(null);

    expect(comp.cachets.map(c => c.id)).toEqual(['b']);
    expect(comp.cachets[0].par_defaut).toBeTrue();
    expect(choisi as any).toBe('b');
  });

  it('un cachet enregistré depuis l\'éditeur rejoint la liste et devient la sélection', () => {
    charger([cachet('a', true)]);
    comp.mode = 'choisir';
    let choisi: string | null = null;
    comp.selectedIdChange.subscribe(id => (choisi = id));
    comp.onEnregistre(cachet('n', true, '2026-09-01'));
    expect(comp.cachets.map(c => c.id)).toEqual(['n', 'a']);
    expect(comp.cachets[1].par_defaut).toBeFalse();
    expect(choisi as any).toBe('n');
    expect(comp.editeurOuvert).toBeFalse();
  });

  it('affiche une erreur si le chargement échoue', () => {
    fixture.detectChanges();
    http.expectOne(URL).flush({}, { status: 500, statusText: 'KO' });
    expect(comp.erreur).toContain('Impossible');
  });
});
