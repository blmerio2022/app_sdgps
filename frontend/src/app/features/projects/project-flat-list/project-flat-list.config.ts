/**
 * Catalogue des vues à plat : colonnes, champs triables, descriptions et clés de config
 * (tri + colonnes) par niveau. Les clés `flat_*` sont déclarées côté serveur dans
 * `accounts/views.py` (TABLE_SORT_FIELDS / TABLE_COLUMN_FIELDS).
 */
import { auditColumns, AUDIT_COLUMN_DESCRIPTIONS, AUDIT_COLUMN_LABELS, AUDIT_COLUMN_ORDER } from '../../../shared/components/column-config/audit-columns';
import { NiveauCible } from '../sous-niveaux-menu/sous-niveaux.util';

export type NiveauPlat = Exclude<NiveauCible, 'ssdgps'>;

export interface FlatColumn {
  field: string;
  label: string;
  visible: boolean;
  type?: 'text' | 'date' | 'number' | 'boolean';
}

interface NiveauDef {
  cle: string;
  titre: string;
  singulier: string;
  icon: string;
  colonnes: FlatColumn[];
  descriptions: Record<string, string>;
}

const num = (field: string, label: string, visible = true): FlatColumn => ({ field, label, visible, type: 'number' });
const txt = (field: string, label: string, visible = true): FlatColumn => ({ field, label, visible, type: 'text' });

export const NIVEAUX_PLATS: Record<NiveauPlat, NiveauDef> = {
  propriete: {
    cle: 'flat_proprietes', titre: 'Toutes les propriétés', singulier: 'propriété', icon: 'fa-map-marker-alt',
    colonnes: [
      txt('id_propriete', 'Identifiant'), txt('nom_propriete', 'Propriété-dite'),
      txt('organisme_niveau2_nom', 'Service'), txt('organisme_niveau1_nom', 'Organisme', false),
      num('nbr_total_affaires', 'Affaires'), num('nbr_total_ssdgps', 'SSDGPS'),
      num('nbr_total_sessions', 'Sessions'), num('nbr_total_pieces', 'Pièces'),
      txt('id_titre', 'Titre foncier', false), txt('id_requisition', 'Réquisition', false),
    ],
    descriptions: {
      id_propriete: 'Titre foncier, sinon réquisition', nom_propriete: 'Nom de la propriété',
      organisme_niveau1_nom: 'Organisme de premier niveau', organisme_niveau2_nom: 'Organisme de deuxième niveau',
      nbr_total_affaires: 'Affaires de la propriété', nbr_total_ssdgps: 'SSDGPS de la propriété',
      nbr_total_sessions: 'Sessions des SSDGPS multi-session', nbr_total_pieces: 'Pièces cumulées',
      id_titre: 'Titre foncier', id_requisition: 'Réquisition',
    },
  },
  affaire: {
    cle: 'flat_affaires', titre: 'Toutes les affaires', singulier: 'affaire', icon: 'fa-file-signature',
    colonnes: [
      num('numero_sd_affaire', 'SD'), txt('propriete_label', 'Propriété'),
      txt('nature_procedure_affaire', 'Procédure'), txt('nature_affaire', 'Nature'),
      { field: 'date_bornage', label: 'Date bornage', visible: true, type: 'date' },
      num('nbr_total_ssdgps', 'SSDGPS'), num('nbr_total_sessions', 'Sessions'), num('nbr_total_pieces', 'Pièces'),
      txt('propriete_nom', 'Propriété-dite', false),
    ],
    descriptions: {
      numero_sd_affaire: "Numéro du SD d'affaire", propriete_label: 'Propriété de rattachement',
      nature_procedure_affaire: 'Nature de procédure', nature_affaire: "Nature d'affaire",
      date_bornage: 'Date de bornage ou de recollement', nbr_total_ssdgps: "SSDGPS de l'affaire",
      nbr_total_sessions: 'Sessions des SSDGPS multi-session', nbr_total_pieces: 'Pièces cumulées',
      propriete_nom: 'Nom de la propriété',
    },
  },
  session: {
    cle: 'flat_sessions', titre: 'Toutes les sessions', singulier: 'session', icon: 'fa-clock',
    colonnes: [
      num('numero_session', 'Session'),
      { field: 'date_session', label: 'Date', visible: true, type: 'date' },
      txt('ssdgps_label', 'SSDGPS'), txt('ssdgps_nature', 'Nature'),
      txt('affaire_numero', 'Affaire (SD)'), txt('propriete_label', 'Propriété'),
      num('nbr_total_pieces', 'Pièces'),
    ],
    descriptions: {
      numero_session: 'Numéro de la session', date_session: 'Date de la session',
      ssdgps_label: 'SSDGPS de rattachement (multi-session)', ssdgps_nature: 'Nature du SSDGPS',
      affaire_numero: "SD d'affaire de rattachement", propriete_label: 'Propriété de rattachement',
      nbr_total_pieces: 'Pièces de la session (propres + communes)',
    },
  },
};

export function colonnesDe(niveau: NiveauPlat): FlatColumn[] {
  return [...NIVEAUX_PLATS[niveau].colonnes.map(c => ({ ...c })), ...auditColumns()];
}

/** Champs triables : toutes les colonnes métier + les colonnes d'audit triables. */
export function triablesDe(niveau: NiveauPlat): { field: string; label: string }[] {
  return [
    ...NIVEAUX_PLATS[niveau].colonnes.map(c => ({ field: c.field, label: c.label })),
    ...AUDIT_COLUMN_ORDER.map(f => ({ field: f, label: AUDIT_COLUMN_LABELS[f] })),
  ];
}

export function descriptionDe(niveau: NiveauPlat, field: string): string {
  return NIVEAUX_PLATS[niveau].descriptions[field] || AUDIT_COLUMN_DESCRIPTIONS[field] || '';
}
