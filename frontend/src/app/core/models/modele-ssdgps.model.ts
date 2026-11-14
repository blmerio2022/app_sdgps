/**
 * Modèles (gabarits) de SDGPS et liste de contrôle des pièces d'un dossier.
 * Cf. backend `projects/modeles.py` et `projects/assistant.py`.
 */
import { NatureSsdgps, Ssdgps, TypeSsdgps } from './project.model';

export type PorteeModele = 'systeme' | 'personnel';

/** Une pièce prévue par un modèle. `numero` n'est renseigné que pour un type répétable (RDN). */
export interface ModelePiece {
  type_piece: string;
  numero: number | null;
  obligatoire: boolean;
  /** Libellé (lecture seule, renvoyé dans `pieces_detail`). */
  nom?: string;
  source?: string;
}

export interface ModeleSsdgps {
  id: string;
  nom: string;
  description?: string;
  nature_ssdgps: NatureSsdgps;
  nature_display?: string;
  type_ssdgps: TypeSsdgps;
  type_display?: string;
  portee: PorteeModele;
  portee_display?: string;
  code_systeme?: string;
  proprietaire_email?: string | null;
  pieces: ModelePiece[];
  pieces_detail?: ModelePiece[];
  nb_pieces?: number;
  /** Garde cosmétique : l'appelant peut-il modifier / supprimer ce modèle ? */
  modifiable?: boolean;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_by_email?: string | null;
  updated_by_email?: string | null;
  deleted_by_email?: string | null;
}

/** État d'une pièce prévue dans la liste de contrôle d'un dossier. */
export type EtatPlan = 'a_importer' | 'brouillon' | 'rejete' | 'valide';

export interface PlanItem {
  type_piece: string;
  numero: number | null;
  nom: string;
  obligatoire: boolean;
  source: string;
  etat: EtatPlan;
  pieces: { id: string; statut: string; session_numero: number | null }[];
}

export interface PlanSsdgps {
  ssdgps: string;
  modele: string | null;
  modele_nom: string;
  items: PlanItem[];
  hors_modele: { id: string; type_piece: string; numero: number | null; nom: string; statut: string }[];
  total: number;
  importees: number;
  validees: number;
  /** Pièces du dossier (dans ou hors modèle) pas encore validées. */
  a_valider: number;
  /** Toutes les pièces obligatoires validées et rien en attente : prêt pour la génération. */
  pret: boolean;
}

/** Un niveau de la chaîne : élément existant OU nouvel élément à créer. */
/** `complement` : champs manquants à poser sur un élément existant (organismes d'une propriété ancienne). */
export type NiveauAssistant<T> = { id: string; complement?: Partial<T> } | { nouveau: Partial<T> };

export interface AssistantPayload {
  projet: NiveauAssistant<any>;
  propriete: NiveauAssistant<any>;
  affaire: NiveauAssistant<any>;
  ssdgps: Partial<Ssdgps>;
  modele: string | null;
  nb_sessions?: number;
}

export interface AssistantResult {
  ssdgps: Ssdgps;
  projet: string;
  propriete: string;
  affaire: string;
  crees: string[];
  plan: PlanSsdgps;
}

export interface ValidationGroupee {
  validees: number;
  echecs: { id: string; type_piece: string; numero: number | null; message: string }[];
  plan: PlanSsdgps;
}
