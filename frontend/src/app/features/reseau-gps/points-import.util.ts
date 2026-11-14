import * as XLSX from 'xlsx';
import { PointReseau } from '../../core/services/reseau-gps.service';

/**
 * Lecture d'une liste de points (CSV / Excel) au format de la pièce LPA :
 * `id, nom_point, x_m, y_m, reference, nature_materialisation, nature_signalisation`
 * (+ colonne facultative `statut` : ancien / nouveau).
 *
 * Les en-têtes sont reconnus sans casse ni accents, sous leur nom technique ou leur libellé
 * (« Nom Point », « X(m) », « Référence »…). Sans en-tête reconnu, l'ordre des colonnes de la
 * LPA est appliqué.
 */

type Champ = keyof PointReseau;

const ALIAS: Record<string, Champ> = {
  id: 'id',
  nompoint: 'nom_point', nom: 'nom_point', point: 'nom_point', name: 'nom_point', matricule: 'nom_point',
  xm: 'x_m', x: 'x_m', est: 'x_m', easting: 'x_m',
  ym: 'y_m', y: 'y_m', nord: 'y_m', northing: 'y_m',
  reference: 'reference', ref: 'reference',
  naturematerialisation: 'nature_materialisation', materialisation: 'nature_materialisation',
  naturesignalisation: 'nature_signalisation', signalisation: 'nature_signalisation',
  statut: 'statut', type: 'statut', etat: 'statut',
};

/** Ordre des colonnes de la LPA (fichier sans en-tête). */
const ORDRE_LPA: Champ[] = ['id', 'nom_point', 'x_m', 'y_m', 'reference', 'nature_materialisation', 'nature_signalisation', 'statut'];

export function normaliserEntete(s: unknown): string {
  // NFD sépare les accents (marques combinantes, \p{M}) des lettres, puis on les retire.
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Nombre au format français ou international (« 420 000,50 », « 420000.5 »). */
export function lireNombre(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  // `\s` couvre aussi l'espace insécable des milliers (« 420 000,50 »).
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function lireStatut(v: unknown): 'ancien' | 'nouveau' {
  return normaliserEntete(v).startsWith('n') ? 'nouveau' : 'ancien';
}

/** Séparateur le plus probable d'une ligne CSV. */
export function detecterSeparateur(ligne: string): string {
  const candidats = [';', '\t', ','];
  return candidats.reduce((best, c) => (ligne.split(c).length > ligne.split(best).length ? c : best), ';');
}

export function lignesCsv(texte: string): string[][] {
  // trimStart retire aussi l'indicateur d'ordre des octets (BOM) des CSV exportés par Excel.
  const lignes = texte.trimStart().split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lignes.length) return [];
  const sep = detecterSeparateur(lignes[0]);
  return lignes.map(l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
}

/** Convertit un tableau de lignes (1re ligne éventuellement d'en-tête) en points. */
export function pointsDepuisLignes(lignes: unknown[][]): PointReseau[] {
  if (!lignes.length) return [];
  const entete = lignes[0].map(normaliserEntete);
  const mapping: (Champ | null)[] = entete.map(h => ALIAS[h] ?? null);
  const avecEntete = mapping.includes('x_m') && mapping.includes('y_m');
  const colonnes: (Champ | null)[] = avecEntete ? mapping : ORDRE_LPA;
  const donnees = avecEntete ? lignes.slice(1) : lignes;
  const points: PointReseau[] = [];
  donnees.forEach(ligne => {
    const p: PointReseau = { nom_point: '', x_m: null, y_m: null, statut: 'ancien' };
    colonnes.forEach((champ, i) => {
      if (!champ || i >= ligne.length) return;
      const v = ligne[i];
      if (champ === 'x_m' || champ === 'y_m') p[champ] = lireNombre(v);
      else if (champ === 'statut') p.statut = lireStatut(v);
      else (p as any)[champ] = String(v ?? '').trim();
    });
    if (p.x_m === null || p.y_m === null) return; // ligne vide, en-tête non reconnu, total…
    if (!p.nom_point) p.nom_point = p.id || `P${points.length + 1}`;
    points.push(p);
  });
  return points;
}

/** Lit un fichier CSV / TXT / XLSX / XLS. */
export async function lireFichierPoints(fichier: File): Promise<PointReseau[]> {
  const nom = fichier.name.toLowerCase();
  if (nom.endsWith('.csv') || nom.endsWith('.txt')) {
    return pointsDepuisLignes(lignesCsv(await fichier.text()));
  }
  const classeur = XLSX.read(await fichier.arrayBuffer(), { type: 'array' });
  const feuille = classeur.Sheets[classeur.SheetNames[0]];
  const lignes = XLSX.utils.sheet_to_json<unknown[]>(feuille, { header: 1, raw: true, blankrows: false });
  return pointsDepuisLignes(lignes);
}
