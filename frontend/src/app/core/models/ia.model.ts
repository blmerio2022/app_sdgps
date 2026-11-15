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

// ---------------------------------------------------------------- configuration

export interface IaFournisseur {
  cle: string; libelle: string; protocole: string; base_url: string;
  modele: string; gratuit: string; obtenir_cle: string;
}

export interface IaConfiguration {
  modifiable: boolean;
  source: 'application' | 'environnement';
  saisie: {
    actif: boolean | null; fournisseur: string; base_url: string; protocole: string;
    modele: string; modeles_secours: string[]; delai: number | null;
    cle_enregistree: boolean; cle_indice: string; cle_illisible: boolean;
  };
  effectif: {
    disponible: boolean; actif: boolean; fournisseur: string; fournisseur_libelle: string;
    protocole: string; adresse: string; modele: string; modeles_essai: string[];
    cle_presente: boolean; cle_indice: string; cle_origine: 'application' | 'environnement' | null;
    delai: number;
  };
  catalogue: IaFournisseur[];
  modifie_le: string | null;
  modifie_par: string | null;
}

/** Champs envoyés pour modifier la configuration (la clé n'est jamais relue). */
export interface IaConfigurationSaisie {
  actif?: boolean | null; fournisseur?: string; base_url?: string; protocole?: string;
  modele?: string; modeles_secours?: string[]; delai?: number | null;
  cle?: string; effacer_cle?: boolean;
}

export interface IaEssai { modele: string; ok: boolean; duree?: number; servi_par?: string; reponse?: string; erreur?: string; }
export interface IaResultatTest { ok: boolean; modeles_accessibles?: number | null; liste_erreur?: string; essais: IaEssai[]; erreur?: string; }

export interface IaPreferences { modele_assistant: string; modele_par_defaut: string; }

// ---------------------------------------------------------------- discussions

export interface IaConversation {
  id: string; titre: string; epinglee: boolean; archivee: boolean;
  created_at: string; updated_at: string; nb_messages?: number | null; extrait?: string;
}

export interface IaMessageConversation {
  id: number; role: 'user' | 'assistant'; contenu: string;
  actions: IaAction[]; outils: string[]; modele: string; created_at: string;
}

export interface IaConversationDetail extends IaConversation { messages: IaMessageConversation[]; }

export type IaEtatConversations = 'actives' | 'archivees' | 'toutes';

// ---------------------------------------------------------------- observations

export interface IaObservationArchivee {
  id: number; piece: string; designation: string; texte: string;
  motif: 'remplacee' | 'supprimee' | 'restauree'; motif_display: string;
  created_at: string; created_by: string | null;
}
