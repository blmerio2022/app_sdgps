import {
  CachetRapportOptions, CachetSignature, PagesCachet, PositionCachet,
} from '../../../core/models/cachet-signature.model';

/**
 * Utilitaires du cachet + signature : mémoire du dernier choix, géométrie de la page
 * miniature (MIROIR de `backend/pieces/cachet.py`) et préparation de l'image côté
 * navigateur avant envoi au serveur.
 */

// ------------------------------------------------------------------ géométrie (miroir backend)
export const TAILLE_MIN_MM = 25;
export const TAILLE_MAX_MM = 90;
export const TAILLE_DEFAUT_MM = 45;
export const HAUTEUR_MAX_MM = 60;
export const MARGE_LATERALE_MM = 12;
export const MARGE_BASSE_MM = 12;
export const A4_PORTRAIT = { l: 210, h: 297 };

export interface BoiteCachet { gauche: number; bas: number; largeur: number; hauteur: number; }

/**
 * Position du cachet sur une page, en POURCENTAGES de la page (pour un rendu CSS).
 * Mêmes règles que `cachet.geometrie` côté serveur : hauteur plafonnée, proportions
 * conservées, cachet posé au-dessus du pied de page.
 */
export function boiteCachet(position: PositionCachet, tailleMm: number, ratio: number,
                            page = A4_PORTRAIT): BoiteCachet {
  let l = tailleMm;
  let h = l * (ratio || 1);
  if (h > HAUTEUR_MAX_MM) { h = HAUTEUR_MAX_MM; l = h / (ratio || 1); }
  let x: number;
  if (position === 'bas-gauche') x = MARGE_LATERALE_MM;
  else if (position === 'bas-centre') x = (page.l - l) / 2;
  else x = page.l - MARGE_LATERALE_MM - l;
  return {
    gauche: (x / page.l) * 100,
    bas: (MARGE_BASSE_MM / page.h) * 100,
    largeur: (l / page.l) * 100,
    hauteur: (h / page.h) * 100,
  };
}

// ------------------------------------------------------------------ mémoire du dernier choix
export const CLE_STOCKAGE = 'sdgps.rapport.cachet';

export interface EtatCachetRapport {
  actif: boolean;
  cachetId: string | null;
  position: PositionCachet;
  taille: number;
  pages: PagesCachet;
}

export const ETAT_DEFAUT: EtatCachetRapport = {
  actif: false, cachetId: null, position: 'bas-droite', taille: TAILLE_DEFAUT_MM, pages: 'toutes',
};

const POSITIONS: PositionCachet[] = ['bas-gauche', 'bas-centre', 'bas-droite'];
const PAGES: PagesCachet[] = ['toutes', 'sauf-garde'];

export function bornerTaille(v: any): number {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return TAILLE_DEFAUT_MM;
  return Math.min(TAILLE_MAX_MM, Math.max(TAILLE_MIN_MM, n));
}

/** Dernier choix de l'opérateur (navigateur). Toute valeur corrompue retombe au défaut. */
export function lireEtat(storage: Storage | null = safeStorage()): EtatCachetRapport {
  try {
    const brut = JSON.parse(storage?.getItem(CLE_STOCKAGE) || 'null');
    if (!brut || typeof brut !== 'object') return { ...ETAT_DEFAUT };
    return {
      actif: !!brut.actif,
      cachetId: typeof brut.cachetId === 'string' ? brut.cachetId : null,
      position: POSITIONS.includes(brut.position) ? brut.position : ETAT_DEFAUT.position,
      taille: bornerTaille(brut.taille ?? TAILLE_DEFAUT_MM),
      pages: PAGES.includes(brut.pages) ? brut.pages : ETAT_DEFAUT.pages,
    };
  } catch {
    return { ...ETAT_DEFAUT };
  }
}

export function ecrireEtat(etat: EtatCachetRapport, storage: Storage | null = safeStorage()): void {
  try { storage?.setItem(CLE_STOCKAGE, JSON.stringify(etat)); } catch { /* quota / privé */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * Réconcilie le choix mémorisé avec la bibliothèque réelle : un cachet supprimé entre-temps
 * cède la place au cachet par défaut (ou au premier) ; sans aucun cachet, l'option s'éteint.
 */
export function reconcilier(etat: EtatCachetRapport, cachets: CachetSignature[]): EtatCachetRapport {
  if (!cachets.length) return { ...etat, actif: false, cachetId: null };
  const existe = cachets.some(c => c.id === etat.cachetId);
  if (existe) return etat;
  const choix = cachets.find(c => c.par_defaut) ?? cachets[0];
  return { ...etat, cachetId: choix.id };
}

/** Options transmises au rapport, ou `null` si l'option est éteinte. */
export function optionsRapport(etat: EtatCachetRapport): CachetRapportOptions | null {
  if (!etat.actif || !etat.cachetId) return null;
  return { cachetId: etat.cachetId, position: etat.position, taille: etat.taille, pages: etat.pages };
}

// ------------------------------------------------------------------ préparation de l'image
/** Côté maximal de l'image envoyée : au-delà, du poids sans gain de netteté. */
export const COTE_MAX_ENVOI = 2000;

export interface ImagePreparee { blob: Blob; dataUrl: string; largeur: number; hauteur: number; }

export function chargerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

export function lireFichier(fichier: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Fichier illisible'));
    r.readAsDataURL(fichier);
  });
}

/**
 * Ramène l'image à `COTE_MAX_ENVOI` px, en JPEG sur fond BLANC (une transparence deviendrait
 * noire en JPEG — le serveur, lui, aplatit aussi sur du blanc), éventuellement tournée.
 * L'orientation EXIF est appliquée par le navigateur au dessin. C'est CETTE image qui sert à
 * l'aperçu et à l'enregistrement : ce que l'opérateur voit est ce qui sera apposé.
 */
export async function preparerImage(src: string, rotation = 0): Promise<ImagePreparee> {
  const img = await chargerImage(src);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const echelle = Math.min(1, COTE_MAX_ENVOI / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * echelle));
  const h = Math.max(1, Math.round(h0 * echelle));
  const tourne = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = tourne ? h : w;
  canvas.height = tourne ? w : h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Conversion impossible'))), 'image/jpeg', 0.92));
  return { blob, dataUrl, largeur: canvas.width, hauteur: canvas.height };
}

/** Rapport hauteur / largeur d'un cachet (1 par défaut). */
export function ratioCachet(c: Pick<CachetSignature, 'largeur_px' | 'hauteur_px'> | null | undefined): number {
  return c && c.largeur_px ? c.hauteur_px / c.largeur_px : 1;
}
