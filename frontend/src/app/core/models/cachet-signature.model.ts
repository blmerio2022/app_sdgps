/**
 * Cachet + signature d'un opérateur, apposable sur les pages du rapport PDF.
 * Strictement personnel : l'API ne renvoie que ceux de l'utilisateur connecté.
 */
export type CouleurEncre = 'origine' | 'bleu' | 'noir';
export type PositionCachet = 'bas-gauche' | 'bas-centre' | 'bas-droite';
export type PagesCachet = 'toutes' | 'sauf-garde';

/** Cadre de recadrage, en fractions [0, 1] de l'image orientée. */
export interface CadreCachet { x: number; y: number; l: number; h: number; }

export interface ParametresTraitement {
  sensibilite: number;          // 0 = encre franche seule … 100 = traits pâles gardés
  couleur: CouleurEncre;
  lissage: boolean;
  rotation: 0 | 90 | 180 | 270;
  cadre: CadreCachet | null;
}

export const PARAMETRES_DEFAUT: ParametresTraitement = {
  sensibilite: 50, couleur: 'origine', lissage: true, rotation: 0, cadre: null,
};

export interface CachetSignature {
  id: string;
  nom: string;
  /** PNG détouré, en data URL (jamais d'URL de média publique). */
  image: string | null;
  parametres: Partial<ParametresTraitement>;
  largeur_px: number;
  hauteur_px: number;
  par_defaut: boolean;
  derniere_utilisation: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApercuTraitement {
  image: string;
  largeur: number;
  hauteur: number;
  seuil: number;
  couverture: number;
  parametres: ParametresTraitement;
}

/** Options d'apposition transmises à la génération du rapport. */
export interface CachetRapportOptions {
  cachetId: string;
  position: PositionCachet;
  taille: number;               // largeur en mm
  pages: PagesCachet;
}
