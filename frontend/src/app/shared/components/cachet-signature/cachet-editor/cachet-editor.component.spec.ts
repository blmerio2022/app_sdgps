import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { CachetEditorComponent, TAILLE_MAX_FICHIER, calculerCadre } from './cachet-editor.component';
import { environment } from '../../../../../environments/environment';

const URL = `${environment.apiUrl}/v1/cachets-signatures/`;
const PREPAREE = { blob: new Blob(['x'], { type: 'image/jpeg' }), dataUrl: 'data:image/jpeg;base64,AA',
                   largeur: 100, hauteur: 80 };
const APERCU = { image: 'data:image/png;base64,BB', largeur: 50, hauteur: 30, seuil: 20,
                 couverture: 0.1, parametres: {} as any };

describe('CachetEditorComponent', () => {
  let fixture: ComponentFixture<CachetEditorComponent>;
  let comp: CachetEditorComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [CachetEditorComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(CachetEditorComponent);
    comp = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('calculerCadre()', () => {
    const plein = { x: 0, y: 0, l: 1, h: 1 };

    it('déplace sans sortir de l\'image', () => {
      const c = calculerCadre('deplacer', { x: 0.2, y: 0.2, l: 0.5, h: 0.5 }, 0.6, -0.5);
      expect(c).toEqual({ x: 0.5, y: 0, l: 0.5, h: 0.5 });
    });

    it('redimensionne par les coins', () => {
      const c = calculerCadre('no', plein, 0.25, 0.1);
      expect(c.x).toBeCloseTo(0.25);
      expect(c.l).toBeCloseTo(0.75);
      expect(c.y).toBeCloseTo(0.1);
      const d = calculerCadre('se', plein, -0.5, -0.5);
      expect(d.l).toBeCloseTo(0.5);
      expect(d.h).toBeCloseTo(0.5);
    });

    it('ne descend jamais sous la taille minimale', () => {
      const c = calculerCadre('ne', { x: 0.4, y: 0.4, l: 0.2, h: 0.2 }, -0.9, 0.9);
      expect(c.l).toBeGreaterThanOrEqual(0.04 - 1e-9);
      expect(c.h).toBeGreaterThanOrEqual(0.04 - 1e-9);
    });
  });

  it('refuse un fichier qui n\'est pas une image, ou trop lourd', () => {
    comp.accepter(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    expect(comp.erreur).toContain('Déposez une image');
    const lourd = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(lourd, 'size', { value: TAILLE_MAX_FICHIER + 1 });
    comp.accepter(lourd);
    expect(comp.erreur).toContain('15 Mo');
  });

  it('demande un aperçu au serveur après un court délai, avec les réglages courants', fakeAsync(() => {
    fixture.detectChanges();
    comp.prepared = PREPAREE;
    comp.couleur = 'noir';
    comp.cadre = { x: 0.1, y: 0.1, l: 0.5, h: 0.5 };
    comp.demanderApercu();
    comp.demanderApercu();          // rafale : une seule requête
    tick(320);
    const req = http.expectOne(`${URL}apercu/`);
    const p = JSON.parse((req.request.body as FormData).get('parametres') as string);
    expect(p.couleur).toBe('noir');
    expect(p.rotation).toBe(0);     // la rotation est déjà appliquée à l'image envoyée
    expect(p.cadre).toEqual({ x: 0.1, y: 0.1, l: 0.5, h: 0.5 });
    req.flush(APERCU);
    expect(comp.apercu?.image).toBe(APERCU.image);
    expect(comp.apercuEnCours).toBeFalse();
  }));

  it('affiche l\'erreur du serveur (aucune encre détectée)', fakeAsync(() => {
    fixture.detectChanges();
    comp.prepared = PREPAREE;
    comp.demanderApercu();
    tick(320);
    http.expectOne(`${URL}apercu/`).flush({ detail: 'Aucune encre détectée' }, { status: 400, statusText: 'Bad' });
    expect(comp.apercuErreur).toBe('Aucune encre détectée');
    expect(comp.peutEnregistrer).toBeFalse();
  }));

  it('le cadre plein n\'est pas envoyé', () => {
    expect(comp.parametres.cadre).toBeNull();
  });

  it('crée un nouveau cachet', () => {
    comp.prepared = PREPAREE;
    comp.apercu = APERCU;
    comp.nom = ' Cabinet ';
    comp.parDefaut = true;
    let recu: any;
    comp.saved.subscribe(c => (recu = c));
    comp.enregistrer();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('nom')).toBe('Cabinet');
    req.flush({ id: 'c1' });
    expect(recu.id).toBe('c1');
  });

  it('reprend un cachet : réglages seuls en JSON, nouvelle image en multipart', () => {
    comp.cachet = { id: 'c1' } as any;
    comp.prepared = PREPAREE;
    comp.apercu = APERCU;
    comp.nom = 'A';
    comp.enregistrer();
    const a = http.expectOne(`${URL}c1/`);
    expect(a.request.body instanceof FormData).toBeFalse();
    expect(a.request.body.parametres.sensibilite).toBe(50);
    a.flush({ id: 'c1' });

    comp.imageModifiee = true;
    comp.enregistrer();
    const b = http.expectOne(`${URL}c1/`);
    expect(b.request.body instanceof FormData).toBeTrue();
    b.flush({ id: 'c1' });
  });

  it('n\'enregistre pas sans nom ni aperçu valide', () => {
    comp.prepared = PREPAREE;
    comp.nom = 'A';
    expect(comp.peutEnregistrer).toBeFalse();     // pas encore d'aperçu
    comp.apercu = APERCU;
    comp.nom = '  ';
    expect(comp.peutEnregistrer).toBeFalse();
  });

  it('charge l\'original d\'un cachet existant et reprend ses réglages', () => {
    comp.cachet = { id: 'c1', nom: 'Gérant', par_defaut: true,
                    parametres: { sensibilite: 70, couleur: 'bleu' } } as any;
    fixture.detectChanges();
    expect(comp.nom).toBe('Gérant');
    expect(comp.sensibilite).toBe(70);
    expect(comp.couleur).toBe('bleu');
    http.expectOne(`${URL}c1/originale/`).flush({ detail: 'introuvable' }, { status: 404, statusText: 'NF' });
    expect(comp.erreur).toBe('introuvable');
  });
});
