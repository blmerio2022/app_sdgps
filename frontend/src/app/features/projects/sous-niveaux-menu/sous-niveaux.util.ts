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
  /** Titre court du niveau dans le menu (« Propriétés », « Sessions »…). */
  titre: string;
  /** Rang dans la hiérarchie (0 = propriété) : décalage visuel en cascade. */
  rang: number;
  icon: string;
  /** Champ de compteur porté par l'entité d'origine (`nbr_total_…`). */
  compteur: string;
  /** Segment de route sous `projets/:id/`. */
  segment: string;
}

export const SOUS_NIVEAUX: Record<NiveauCible, SousNiveau> = {
  propriete: { niveau: 'propriete', titre: 'Propriétés', rang: 0, label: 'Toutes les propriétés', icon: 'fa-map-marker-alt',
               compteur: 'nbr_total_proprietes', segment: 'proprietes' },
  affaire: { niveau: 'affaire', titre: 'Affaires (SD)', rang: 1, label: 'Toutes les affaires', icon: 'fa-file-signature',
             compteur: 'nbr_total_affaires', segment: 'affaires' },
  ssdgps: { niveau: 'ssdgps', titre: 'SSDGPS', rang: 2, label: 'Tous les SSDGPS', icon: 'fa-satellite-dish',
            compteur: 'nbr_total_ssdgps', segment: 'ssdgps' },
  session: { niveau: 'session', titre: 'Sessions', rang: 3, label: 'Toutes les sessions', icon: 'fa-clock',
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

/** Nom de l'élément d'origine, en tête du menu (« Propriété T9002/C »…). */
export function nomEntite(niveau: NiveauEntite, e: any): string {
  if (!e) return '';
  switch (niveau) {
    case 'projet': return e.nom_projet || e.code_projet || 'Projet';
    case 'propriete': return `Propriété ${e.id_titre || e.id_requisition || e.nom_propriete || ''}`.trim();
    case 'affaire': return `Affaire SD ${e.numero_sd_affaire ?? ''}`.trim();
    case 'ssdgps': return `SSDGPS n°${e.numero_ssdgps ?? ''}`;
    default: return '';
  }
}

/** « de ce projet », « de cette propriété »… (sous-titre de chaque niveau). */
export function complementDe(niveau: NiveauEntite): string {
  return ({ projet: 'de ce projet', propriete: 'de cette propriété', affaire: 'de cette affaire',
            ssdgps: 'de ce SSDGPS', session: '' } as Record<NiveauEntite, string>)[niveau];
}
