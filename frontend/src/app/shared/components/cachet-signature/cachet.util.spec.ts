import {
  CLE_STOCKAGE, ETAT_DEFAUT, boiteCachet, bornerTaille, ecrireEtat, lireEtat, optionsRapport,
  ratioCachet, reconcilier,
} from './cachet.util';
import { CachetSignature } from '../../../core/models/cachet-signature.model';

function cachet(id: string, defaut = false): CachetSignature {
  return { id, nom: id, image: null, parametres: {}, largeur_px: 200, hauteur_px: 100,
           par_defaut: defaut, derniere_utilisation: null, created_at: '', updated_at: '' };
}

class FauxStockage {
  data: Record<string, string> = {};
  getItem(k: string) { return this.data[k] ?? null; }
  setItem(k: string, v: string) { this.data[k] = v; }
}

describe('cachet.util', () => {
  describe('boiteCachet() — miroir de la géométrie serveur', () => {
    it('pose le cachet à 12 mm du bord, au-dessus du pied de page', () => {
      const d = boiteCachet('bas-droite', 45, 0.5);
      expect(d.largeur).toBeCloseTo(45 / 210 * 100, 3);
      expect(d.gauche + d.largeur).toBeCloseTo((210 - 12) / 210 * 100, 3);
      expect(d.bas).toBeCloseTo(12 / 297 * 100, 3);
      expect(boiteCachet('bas-gauche', 45, 0.5).gauche).toBeCloseTo(12 / 210 * 100, 3);
      const c = boiteCachet('bas-centre', 45, 0.5);
      expect(c.gauche + c.largeur / 2).toBeCloseTo(50, 3);
    });

    it('plafonne la hauteur à 60 mm en gardant les proportions', () => {
      const b = boiteCachet('bas-droite', 90, 1.5);
      expect(b.hauteur).toBeCloseTo(60 / 297 * 100, 3);
      expect(b.largeur).toBeCloseTo(40 / 210 * 100, 3);
    });
  });

  it('bornerTaille() reste entre 25 et 90 mm', () => {
    expect(bornerTaille(5)).toBe(25);
    expect(bornerTaille(200)).toBe(90);
    expect(bornerTaille('abc')).toBe(45);
    expect(bornerTaille(50.4)).toBe(50);
  });

  it('mémorise et relit le dernier choix ; une valeur corrompue retombe au défaut', () => {
    const fs = new FauxStockage();
    const st = fs as unknown as Storage;
    ecrireEtat({ actif: true, cachetId: 'c1', position: 'bas-centre', taille: 60, pages: 'sauf-garde' }, st);
    expect(lireEtat(st)).toEqual({ actif: true, cachetId: 'c1', position: 'bas-centre', taille: 60, pages: 'sauf-garde' });
    fs.data[CLE_STOCKAGE] = '{pas du json';
    expect(lireEtat(st)).toEqual(ETAT_DEFAUT);
    fs.data[CLE_STOCKAGE] = JSON.stringify({ actif: true, position: 'haut', taille: 999, pages: 'x' });
    const e = lireEtat(st);
    expect([e.position, e.taille, e.pages]).toEqual(['bas-droite', 90, 'toutes']);
  });

  it('reconcilier() remplace un cachet disparu par le défaut, éteint sans cachet', () => {
    const etat = { ...ETAT_DEFAUT, actif: true, cachetId: 'ancien' };
    expect(reconcilier(etat, [cachet('a'), cachet('b', true)]).cachetId).toBe('b');
    expect(reconcilier(etat, [cachet('a')]).cachetId).toBe('a');
    expect(reconcilier({ ...etat, cachetId: 'a' }, [cachet('a'), cachet('b', true)]).cachetId).toBe('a');
    expect(reconcilier(etat, []).actif).toBeFalse();
  });

  it('optionsRapport() : null quand l\'option est éteinte', () => {
    expect(optionsRapport({ ...ETAT_DEFAUT, cachetId: 'c' })).toBeNull();
    expect(optionsRapport({ ...ETAT_DEFAUT, actif: true, cachetId: 'c' }))
      .toEqual({ cachetId: 'c', position: 'bas-droite', taille: 45, pages: 'toutes' });
  });

  it('ratioCachet()', () => {
    expect(ratioCachet(cachet('a'))).toBe(0.5);
    expect(ratioCachet(null)).toBe(1);
  });
});
