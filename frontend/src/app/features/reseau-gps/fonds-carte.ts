/**
 * Fonds de carte du module « Réseau GPS ».
 *
 * Fonds intégrés : uniquement des services dont les conditions d'utilisation autorisent un
 * usage direct des tuiles avec attribution (OpenStreetMap, Esri, OpenTopoMap, CARTO).
 * Google Satellite n'est PAS intégré : ses tuiles ne sont utilisables qu'au travers des API
 * Google Maps (clé + conditions). Un opérateur qui dispose d'un accès légitime peut l'ajouter
 * comme fond personnel (URL XYZ ou WMS) — ces fonds sont enregistrés dans le navigateur.
 */

export type TypeFond = 'xyz' | 'wms';

export interface FondCarte {
  id: string;
  nom: string;
  type: TypeFond;
  url: string;
  attribution?: string;
  maxZoom?: number;
  /** WMS : couches (paramètre LAYERS). */
  couches?: string;
  /** WMS : format d'image. */
  format?: string;
  personnel?: boolean;
}

export const FONDS_INTEGRES: FondCarte[] = [
  {
    id: 'osm', nom: 'OpenStreetMap', type: 'xyz',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
    attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    id: 'esri-imagerie', nom: 'Imagerie satellite (Esri)', type: 'xyz',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
    attribution: 'Tuiles &copy; Esri — Esri, Maxar, Earthstar Geographics, communauté des utilisateurs SIG',
  },
  {
    id: 'esri-topo', nom: 'Topographie (Esri)', type: 'xyz',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
    attribution: 'Tuiles &copy; Esri',
  },
  {
    id: 'opentopomap', nom: 'OpenTopoMap (relief)', type: 'xyz',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17,
    attribution: '&copy; OpenStreetMap, SRTM — style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
  {
    id: 'carto-clair', nom: 'CARTO clair', type: 'xyz',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', maxZoom: 20,
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: 'carto-sombre', nom: 'CARTO sombre', type: 'xyz',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', maxZoom: 20,
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
];

export const CLE_FONDS_PERSONNELS = 'reseauGps.fondsPersonnels';
export const CLE_FOND_ACTIF = 'reseauGps.fondActif';

export function chargerFondsPersonnels(stockage: Storage = localStorage): FondCarte[] {
  try {
    const brut = JSON.parse(stockage.getItem(CLE_FONDS_PERSONNELS) || '[]');
    return Array.isArray(brut)
      ? brut.filter(f => f && typeof f.url === 'string' && typeof f.nom === 'string')
            .map(f => ({ ...f, personnel: true, type: f.type === 'wms' ? 'wms' : 'xyz' }))
      : [];
  } catch {
    return [];
  }
}

export function enregistrerFondsPersonnels(fonds: FondCarte[], stockage: Storage = localStorage): void {
  stockage.setItem(CLE_FONDS_PERSONNELS, JSON.stringify(fonds.filter(f => f.personnel)));
}

/** Erreur de saisie d'un fond personnel, ou null s'il est valide. */
export function validerFond(f: Partial<FondCarte>): string | null {
  if (!f.nom || !f.nom.trim()) return 'Donnez un nom au fond de carte.';
  const url = (f.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return "L'URL doit commencer par http:// ou https://.";
  if (f.type === 'wms') {
    if (!f.couches || !f.couches.trim()) return 'Indiquez la ou les couches WMS (paramètre LAYERS).';
  } else if (!(url.includes('{z}') && url.includes('{x}') && url.includes('{y}'))) {
    return "Une URL XYZ doit contenir {z}, {x} et {y} (ex. https://…/{z}/{x}/{y}.png).";
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
