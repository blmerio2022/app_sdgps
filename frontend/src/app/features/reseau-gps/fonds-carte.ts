import { FondCatalogue } from '../../core/services/reseau-gps.service';

/**
 * Fonds de carte du module « Réseau GNSS ».
 *
 * Le **catalogue** est construit par l'application (backend `reseaux/fonds.py`, services
 * gratuits ou à accès gratuit, licence affichée). L'opérateur compose « Mes fonds » en y
 * puisant, retire ceux qu'il n'utilise plus, et peut ajouter des fonds personnalisés
 * (XYZ / WMS). Ses choix sont mémorisés dans le navigateur.
 */

export type TypeFond = 'xyz' | 'wms';

export interface FondCarte {
  id: string;
  nom: string;
  type: TypeFond;
  url: string;
  attribution?: string;
  maxZoom?: number;
  couches?: string;
  format?: string;
  personnel?: boolean;
  categorie?: string;
  /** Sous-domaines pour {s} (« 0123 » pour Google). */
  sousDomaines?: string;
}

/** Choix de l'opérateur : identifiants du catalogue retenus + fonds personnalisés. */
export interface MesFonds { ids: string[]; persos: FondCarte[]; actif: string | null; }

export const CLE_MES_FONDS = 'reseauGps.mesFonds';
/** Version des choix enregistrés : la v2 ajoute Google Satellite (actif) et Google hybride. */
export const VERSION_MES_FONDS = 2;
export const FONDS_V2 = ['google-satellite', 'google-hybride'];

export function depuisCatalogue(f: FondCatalogue): FondCarte {
  return {
    id: f.id, nom: f.nom, type: f.type, url: f.url, attribution: f.attribution, maxZoom: f.max_zoom,
    couches: f.couches, format: f.format, categorie: f.categorie, sousDomaines: f.sous_domaines,
  };
}

export function chargerMesFonds(parDefaut: string[], stockage: Storage = localStorage): MesFonds {
  try {
    const brut = JSON.parse(stockage.getItem(CLE_MES_FONDS) || 'null');
    if (brut && Array.isArray(brut.ids)) {
      let ids: string[] = brut.ids.filter((x: unknown) => typeof x === 'string');
      let actif = typeof brut.actif === 'string' ? brut.actif : null;
      if ((brut.v || 1) < VERSION_MES_FONDS) {
        // Choix enregistrés avant l'ajout de Google : ajoutés en tête, Google Satellite actif.
        ids = [...FONDS_V2.filter(id => parDefaut.includes(id) && !ids.includes(id)), ...ids];
        if (parDefaut.includes(FONDS_V2[0])) actif = FONDS_V2[0];
      }
      return {
        ids,
        persos: (Array.isArray(brut.persos) ? brut.persos : [])
          .filter((f: any) => f && typeof f.url === 'string' && typeof f.nom === 'string')
          .map((f: any) => ({ ...f, personnel: true, type: f.type === 'wms' ? 'wms' : 'xyz' })),
        actif,
      };
    }
  } catch { /* stockage illisible : valeurs par défaut */ }
  return { ids: [...parDefaut], persos: [], actif: parDefaut[0] ?? null };
}

export function enregistrerMesFonds(m: MesFonds, stockage: Storage = localStorage): void {
  stockage.setItem(CLE_MES_FONDS, JSON.stringify({ ...m, v: VERSION_MES_FONDS }));
}

/** Liste affichable de « Mes fonds » (catalogue retenu, dans l'ordre choisi, puis personnels). */
export function listeMesFonds(m: MesFonds, catalogue: FondCatalogue[]): FondCarte[] {
  const parId = new Map(catalogue.map(f => [f.id, f]));
  return [
    ...m.ids.map(id => parId.get(id)).filter((f): f is FondCatalogue => !!f).map(depuisCatalogue),
    ...m.persos,
  ];
}

/** Retire un fond (du catalogue ou personnel) ; l'actif passe au premier restant. */
export function retirerFond(m: MesFonds, id: string): MesFonds {
  const ids = m.ids.filter(x => x !== id);
  const persos = m.persos.filter(f => f.id !== id);
  const restants = [...ids, ...persos.map(f => f.id)];
  return { ids, persos, actif: m.actif === id ? (restants[0] ?? null) : m.actif };
}

export function ajouterDuCatalogue(m: MesFonds, id: string): MesFonds {
  return m.ids.includes(id) ? m : { ...m, ids: [...m.ids, id], actif: m.actif ?? id };
}

/** Erreur de saisie d'un fond personnalisé, ou null s'il est valide. */
export function validerFond(f: Partial<FondCarte>): string | null {
  if (!f.nom || !f.nom.trim()) return 'Donnez un nom au fond de carte.';
  const url = (f.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return "L'URL doit commencer par http:// ou https://.";
  if (f.type === 'wms') {
    if (!f.couches || !f.couches.trim()) return 'Indiquez la ou les couches WMS (paramètre LAYERS).';
    if (url.includes('?')) return "Saisissez l'URL du service WMS sans paramètres (sans « ? »).";
  } else if (!(url.includes('{z}') && url.includes('{x}') && url.includes('{y}'))) {
    return 'Une URL XYZ doit contenir {z}, {x} et {y} (ex. https://…/{z}/{x}/{y}.png).';
  }
  return null;
}

export function nouveauFondPersonnel(f: Partial<FondCarte>): FondCarte {
  return {
    id: `perso-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nom: (f.nom || '').trim(),
    type: f.type === 'wms' ? 'wms' : 'xyz',
    url: (f.url || '').trim(),
    couches: f.couches?.trim() || undefined,
    format: f.type === 'wms' ? (f.format || 'image/png') : undefined,
    attribution: f.attribution?.trim() || undefined,
    maxZoom: 20,
    personnel: true,
  };
}
