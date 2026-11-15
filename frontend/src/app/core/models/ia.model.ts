/** Intelligence artificielle — types des réponses de `/api/v1/ia/`. L'IA PROPOSE :
 * rien de ce qui suit n'est enregistré tant que l'opérateur ne l'a pas validé. */

export interface IaStatut {
  disponible: boolean;
  modele: string | null;
  /** Vrai si l'IA passe par une passerelle (OmniRoute…) plutôt que l'API Anthropic. */
  passerelle?: boolean | null;
  /** Libellé du fournisseur choisi (Google Gemini, OpenRouter…), s'il est configuré. */
  fournisseur?: string | null;
}

export type IaConfiance = 'haute' | 'moyenne' | 'faible';

/** N°4 — association proposée entre un champ du catalogue et une colonne du fichier. */
export interface IaPropositionMapping {
  champ: string;
  colonne: string;
  confiance: IaConfiance;
  raison: string;
}

/** N°6 — observation proposée pour une pièce (colonne « Observations » de la garde). */
export interface IaPropositionObservation {
  piece: string;
  designation: string;
  observation_actuelle: string;
  observation: string;
}

/** N°5 — bouton proposé par l'assistant ; c'est l'utilisateur qui clique. */
export interface IaAction { action: string; libelle: string; route: string; }

export interface IaMessage { role: 'user' | 'assistant'; content: string; actions?: IaAction[]; }

export interface IaReponseAssistant { reponse: string; actions: IaAction[]; outils: string[]; }
