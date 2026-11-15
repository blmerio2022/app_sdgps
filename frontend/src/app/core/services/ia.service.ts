import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  IaConfiguration, IaConfigurationSaisie, IaConversation, IaConversationDetail,
  IaEtatConversations, IaMessage, IaMessageConversation, IaObservationArchivee,
  IaPreferences, IaPropositionMapping, IaPropositionObservation, IaReponseAssistant,
  IaResultatTest, IaStatut,
} from '../models/ia.model';

/**
 * Intelligence artificielle (`/api/v1/ia/`) — inerte tant que le serveur ne l'a pas
 * activée : `disponible$` vaut alors `false` et les boutons IA restent masqués.
 *
 * Toutes les fonctions de rédaction PROPOSENT ; l'opérateur relit et décide. Chaque
 * appel au modèle est journalisé côté serveur et plafonné en débit.
 */
@Injectable({ providedIn: 'root' })
export class IaService {
  private url = `${environment.apiUrl}/v1/ia/`;
  private statut$?: Observable<IaStatut>;

  constructor(private http: HttpClient) {}

  /** Statut, interrogé une fois par session (une erreur vaut « indisponible »). */
  statut(): Observable<IaStatut> {
    if (!this.statut$) {
      this.statut$ = this.http.get<IaStatut>(`${this.url}statut/`).pipe(
        catchError(() => of({ disponible: false, modele: null })),
        shareReplay(1),
      );
    }
    return this.statut$;
  }

  get disponible$(): Observable<boolean> {
    return this.statut().pipe(map(s => !!s.disponible));
  }

  /** À appeler après un changement de configuration : le statut sera relu. */
  oublierStatut(): void { this.statut$ = undefined; }

  // ------------------------------------------------------------ fonctions d'IA

  /** N°4 — compléter la correspondance des colonnes d'un import. */
  mappingColonnes(typePiece: string, colonnes: string[], lignes: string[][],
                  deja: Record<string, string>): Observable<{ propositions: IaPropositionMapping[] }> {
    return this.http.post<{ propositions: IaPropositionMapping[] }>(`${this.url}mapping-colonnes/`, {
      type_piece: typePiece, colonnes, lignes: lignes.slice(0, 5), deja,
    });
  }

  /** N°6 — brouillons d'observations : tout le dossier, ou les pièces choisies, guidés
   * par une consigne générale et/ou des consignes par pièce. */
  observations(ssdgpsId: string, options: { pieces?: string[]; consigne?: string;
                                           consignes?: Record<string, string> } = {}):
      Observable<{ propositions: IaPropositionObservation[] }> {
    const corps: any = { ssdgps: ssdgpsId };
    if (options.pieces?.length) corps.pieces = options.pieces;
    if (options.consigne?.trim()) corps.consigne = options.consigne.trim();
    const consignes = Object.fromEntries(Object.entries(options.consignes || {})
      .filter(([, v]) => (v || '').trim()));
    if (Object.keys(consignes).length) corps.consignes = consignes;
    return this.http.post<{ propositions: IaPropositionObservation[] }>(`${this.url}observations/`, corps);
  }

  /** Enregistre des observations ; l'ancienne version de chaque pièce est archivée. */
  appliquerObservations(ssdgpsId: string, observations: { piece: string; texte: string }[]):
      Observable<{ modifiees: number; ignorees: number }> {
    return this.http.post<{ modifiees: number; ignorees: number }>(
      `${this.url}observations/appliquer/`, { ssdgps: ssdgpsId, observations });
  }

  /** Efface l'observation de pièces choisies, ou de toutes (`toutes`), en l'archivant. */
  supprimerObservations(ssdgpsId: string, pieces: string[] | 'toutes'): Observable<{ supprimees: number }> {
    const corps = pieces === 'toutes' ? { ssdgps: ssdgpsId, toutes: true } : { ssdgps: ssdgpsId, pieces };
    return this.http.post<{ supprimees: number }>(`${this.url}observations/supprimer/`, corps);
  }

  historiqueObservations(ssdgpsId: string, pieceId?: string): Observable<IaObservationArchivee[]> {
    let params = new HttpParams().set('ssdgps', ssdgpsId);
    if (pieceId) params = params.set('piece', pieceId);
    return this.http.get<IaObservationArchivee[]>(`${this.url}observations/historique/`, { params });
  }

  restaurerObservation(archiveId: number): Observable<{ piece: string; texte: string }> {
    return this.http.post<{ piece: string; texte: string }>(
      `${this.url}observations/restaurer/`, { archive: archiveId });
  }

  /** N°6 — brouillon de note de synthèse d'un SDGPS. */
  synthese(ssdgpsId: string): Observable<{ texte: string }> {
    return this.http.post<{ texte: string }>(`${this.url}synthese/`, { ssdgps: ssdgpsId });
  }

  /** N°5 — un tour de conversation sans historique serveur (ancienne API). */
  assistant(messages: IaMessage[]): Observable<IaReponseAssistant> {
    return this.http.post<IaReponseAssistant>(`${this.url}assistant/`, {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
  }

  // ------------------------------------------------------------ discussions

  conversations(q = '', etat: IaEtatConversations = 'actives'): Observable<IaConversation[]> {
    let params = new HttpParams().set('etat', etat);
    if (q.trim()) params = params.set('q', q.trim());
    return this.http.get<IaConversation[]>(`${this.url}conversations/`, { params });
  }

  creerConversation(titre = ''): Observable<IaConversationDetail> {
    return this.http.post<IaConversationDetail>(`${this.url}conversations/`, { titre });
  }

  conversation(id: string): Observable<IaConversationDetail> {
    return this.http.get<IaConversationDetail>(`${this.url}conversations/${id}/`);
  }

  modifierConversation(id: string, changements: Partial<Pick<IaConversation, 'titre' | 'epinglee' | 'archivee'>>):
      Observable<IaConversation> {
    return this.http.patch<IaConversation>(`${this.url}conversations/${id}/`, changements);
  }

  supprimerConversation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}conversations/${id}/`);
  }

  envoyerMessage(id: string, contenu: string):
      Observable<{ message: IaMessageConversation; question: IaMessageConversation; titre: string }> {
    return this.http.post<{ message: IaMessageConversation; question: IaMessageConversation; titre: string }>(
      `${this.url}conversations/${id}/messages/`, { contenu });
  }

  regenerer(id: string): Observable<{ message: IaMessageConversation }> {
    return this.http.post<{ message: IaMessageConversation }>(`${this.url}conversations/${id}/regenerer/`, {});
  }

  exporter(id: string): Observable<{ nom_fichier: string; contenu: string }> {
    return this.http.get<{ nom_fichier: string; contenu: string }>(`${this.url}conversations/${id}/export/`);
  }

  // ------------------------------------------------------------ configuration

  configuration(): Observable<IaConfiguration> {
    return this.http.get<IaConfiguration>(`${this.url}config/`);
  }

  enregistrerConfiguration(saisie: IaConfigurationSaisie): Observable<IaConfiguration> {
    return this.http.put<IaConfiguration>(`${this.url}config/`, saisie).pipe(tap(() => this.oublierStatut()));
  }

  reinitialiserConfiguration(): Observable<IaConfiguration> {
    return this.http.post<IaConfiguration>(`${this.url}config/reinitialiser/`, {})
      .pipe(tap(() => this.oublierStatut()));
  }

  testerConfiguration(): Observable<IaResultatTest> {
    return this.http.post<IaResultatTest>(`${this.url}config/tester/`, {});
  }

  modeles(filtre = ''): Observable<{ modeles: string[]; total?: number; erreur?: string }> {
    const params = filtre.trim() ? new HttpParams().set('filtre', filtre.trim()) : undefined;
    return this.http.get<{ modeles: string[]; total?: number; erreur?: string }>(`${this.url}modeles/`, { params });
  }

  preferences(): Observable<IaPreferences> {
    return this.http.get<IaPreferences>(`${this.url}preferences/`);
  }

  enregistrerPreferences(modeleAssistant: string): Observable<IaPreferences> {
    return this.http.put<IaPreferences>(`${this.url}preferences/`, { modele_assistant: modeleAssistant });
  }
}

/** Message d'erreur lisible d'un appel IA (le serveur renvoie toujours un `detail`). */
export function messageErreurIa(err: any): string {
  if (err?.status === 429) return 'Trop de demandes à l\'IA : patientez quelques minutes.';
  if (err?.status === 403) return 'Action réservée à l\'administration de l\'application.';
  return err?.error?.detail || 'Le service d\'IA n\'a pas pu répondre. Réessayez.';
}

/** Télécharge un texte comme fichier (export d'une discussion). */
export function telechargerTexte(nomFichier: string, contenu: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
