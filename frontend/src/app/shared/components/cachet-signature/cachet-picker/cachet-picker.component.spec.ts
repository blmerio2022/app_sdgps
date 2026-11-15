import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CachetPickerComponent } from './cachet-picker.component';
import { CLE_STOCKAGE } from '../cachet.util';
import { CachetRapportOptions, CachetSignature } from '../../../../core/models/cachet-signature.model';

function cachet(id: string, defaut = false): CachetSignature {
  return { id, nom: id, image: null, parametres: {}, largeur_px: 200, hauteur_px: 100,
           par_defaut: defaut, derniere_utilisation: null, created_at: '', updated_at: '' };
}

describe('CachetPickerComponent', () => {
  let fixture: ComponentFixture<CachetPickerComponent>;
  let comp: CachetPickerComponent;
  let emis: (CachetRapportOptions | null)[];

  function creer() {
    fixture = TestBed.createComponent(CachetPickerComponent);
    comp = fixture.componentInstance;
    emis = [];
    comp.optionsChange.subscribe(o => emis.push(o));
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.removeItem(CLE_STOCKAGE);
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [CachetPickerComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
  });

  afterEach(() => localStorage.removeItem(CLE_STOCKAGE));

  it('éteint par défaut : aucun cachet transmis', () => {
    creer();
    expect(comp.etat.actif).toBeFalse();
    expect(emis[emis.length - 1]).toBeNull();
  });

  it('activé, n\'émet rien tant que la bibliothèque n\'a pas confirmé le cachet', () => {
    creer();
    comp.basculer();
    expect(emis[emis.length - 1]).toBeNull();
    comp.onCachets([cachet('a'), cachet('b', true)]);
    expect(emis[emis.length - 1]).toEqual(
      { cachetId: 'b', position: 'bas-droite', taille: 45, pages: 'toutes' });
  });

  it('les réglages sont transmis et mémorisés pour le prochain rapport', () => {
    creer();
    comp.basculer();
    comp.onCachets([cachet('a', true)]);
    comp.choisirPosition('bas-centre');
    comp.changerTaille(60);
    comp.choisirPages('sauf-garde');
    expect(emis[emis.length - 1]).toEqual(
      { cachetId: 'a', position: 'bas-centre', taille: 60, pages: 'sauf-garde' });

    creer();                                   // nouvelle ouverture de la modale
    expect(comp.etat).toEqual(jasmine.objectContaining(
      { actif: true, cachetId: 'a', position: 'bas-centre', taille: 60, pages: 'sauf-garde' }));
  });

  it('sans aucun cachet, l\'interrupteur reste ouvert mais rien n\'est apposé', () => {
    creer();
    comp.basculer();
    comp.onCachets([]);
    expect(comp.etat.actif).toBeTrue();
    expect(emis[emis.length - 1]).toBeNull();
  });

  it('éteindre l\'option retire le cachet de la demande', () => {
    creer();
    comp.basculer();
    comp.onCachets([cachet('a', true)]);
    comp.basculer();
    expect(emis[emis.length - 1]).toBeNull();
  });

  it('la miniature suit la position et les proportions du cachet', () => {
    creer();
    comp.onCachets([cachet('a', true)]);
    comp.choisirPosition('bas-gauche');
    expect(comp.boite.gauche).toBeCloseTo(12 / 210 * 100, 3);
    expect(comp.boite.hauteur / comp.boite.largeur).toBeCloseTo(0.5 * 210 / 297, 3);
  });
});
