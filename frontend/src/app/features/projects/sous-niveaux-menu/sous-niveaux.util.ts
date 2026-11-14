/**
 * Navigation « à plat » entre niveaux : depuis un projet, une propriété, une affaire ou un
 * SSDGPS, afficher TOUS les éléments d'un niveau inférieur, sans descendre la hiérarchie
 * niveau par niveau.
 */
export type NiveauEntite = 'projet' | 'propriete' | 'affaire' | 'ssdgps' | 'session';
export type NiveauCible = 'propriete' | 'affaire' | 'ssdgps' | 'session';

export interface SousNiveau {
  niveau: NiveauCible;
  label: string;
  icon: string;
  /** Champ de compteur porté par l'entité d'origine (`nbr_total_…`). */
  compteur: string;
  /** Segment de route sous `projets/:id/`. */
  segment: string;
}

export const SOUS_NIVEAUX: Record<NiveauCible, SousNiveau> = {
  propriete: { niveau: 'propriete', label: 'Toutes les propriétés', icon: 'fa-map-marker-alt',
               compteur: 'nbr_total_proprietes', segment: 'proprietes' },
  affaire: { niveau: 'affaire', label: 'Toutes les affaires', icon: 'fa-file-signature',
             compteur: 'nbr_total_affaires', segment: 'affaires' },
  ssdgps: { niveau: 'ssdgps', label: 'Tous les SSDGPS', icon: 'fa-satellite-dish',
            compteur: 'nbr_total_ssdgps', segment: 'ssdgps' },
  session: { niveau: 'session', label: 'Toutes les sessions', icon: 'fa-clock',
             compteur: 'nbr_total_sessions', segment: 'sessions' },
};

const ORDRE: NiveauCible[] = ['propriete', 'affaire', 'ssdgps', 'session'];
const RANG: Record<NiveauEntite, number> = { projet: -1, propriete: 0, affaire: 1, ssdgps: 2, session: 3 };

/** Niveaux strictement inférieurs à `niveau` (un SSDGPS mono-session n'a pas de sessions
 * visibles : sa session est structurelle). */
export function sousNiveauxDe(niveau: NiveauEntite, entite?: any): SousNiveau[] {
  const out = ORDRE.filter(n => RANG[n] > RANG[niveau]).map(n => SOUS_NIVEAUX[n]);
  if (niveau === 'ssdgps' && entite?.type_ssdgps === 'mono-session') return [];
  return out;
}

/** Portée (query params) d'une vue à plat ouverte depuis `entite` de niveau `niveau`. */
export function porteeDe(niveau: NiveauEntite, entite: any): Record<string, string> {
  switch (niveau) {
    case 'propriete': return { propriete: entite.id };
    case 'affaire': return { affaire: entite.id, propriete: entite.propriete };
    case 'ssdgps': return { ssdgps: entite.id, affaire: entite.affaire, propriete: entite.propriete };
    default: return {};
  }
}

/** Base absolue « …/projets » (fonctionne sous /projets ET /admin/projets). */
export function projetsBase(url: string): string[] {
  const segs = url.split('?')[0].split('/').filter(Boolean);
  const idx = segs.lastIndexOf('projets');
  return ['/', ...(idx >= 0 ? segs.slice(0, idx + 1) : ['projets'])];
}
