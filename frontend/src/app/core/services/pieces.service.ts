import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Piece, PieceImage, PieceImportPreview, PieceTypeDef } from '../models/piece.model';

interface PieceParent {
  ssdgps?: string;
  session?: string;
}

/** Source des coordonnées calculées pour le « Rapport de contrôle » (RC) :
 * `rdn` = Rapports de la détermination N°k ; `rdia` = Rapport des déterminations
 * intermédiaires assemblé. */
export type RcSource = 'rdn' | 'rdia';

/** Pièce candidate à l'application du tri configuré sur son tableau stocké. */
export interface SortablePiece {
  id: string;
  type_piece: string;
  type_nom: string;
  numero: number | null;
  row_count: number;
  ssdgps_id: string;
  ssdgps_label: string;
  session_numero: number | null;
}

/** Service CRUD + import des pièces (Phase 6.5). Calqué sur ProjectsService. */
@Injectable({ providedIn: 'root' })
export class PiecesService {
  private base = `${environment.apiUrl}/v1/pieces/`;

  constructor(private http: HttpClient) {}

  getCatalog(): Observable<PieceTypeDef[]> {
    return this.http.get<PieceTypeDef[]>(`${this.base}catalog/`);
  }

  /** Catalogue enrichi des descriptions/infobulles (endpoint admin) — écran d'édition
   * des descriptions des champs (App Admin uniquement, 403 sinon). */
  getFieldDescriptions(): Observable<PieceTypeDef[]> {
    return this.http.get<PieceTypeDef[]>(`${this.base}field-descriptions/`);
  }

  /** Upsert des descriptions/infobulles des champs (App Admin uniquement). Corps :
   * `{ '<TYPE>': { '<field_name>': { description, tooltip } } }`. Une valeur vide
   * (description ET tooltip) supprime la métadonnée. Renvoie le catalogue mis à jour. */
  saveFieldDescriptions(
    payload: Record<string, Record<string, { description: string; tooltip: string }>>,
  ): Observable<PieceTypeDef[]> {
    return this.http.put<PieceTypeDef[]>(`${this.base}field-descriptions/`, payload);
  }

  /**
   * Définit les champs OBLIGATOIRES (verrouillés) de la vue « Import des données » par type
   * de pièce (App Admin uniquement, 403 sinon). Corps : `{ '<TYPE>': ['<field_name>', …] }`
   * (ensemble exact par type). Renvoie le catalogue mis à jour.
   */
  saveRequiredFields(payload: Record<string, string[]>): Observable<PieceTypeDef[]> {
    return this.http.put<PieceTypeDef[]>(`${this.base}required-fields/`, payload);
  }

  private list(params: Record<string, any>): Observable<Piece[]> {
    let httpParams = new HttpParams();
    Object.keys(params).forEach(k => {
      if (params[k] !== null && params[k] !== undefined && params[k] !== '') {
        httpParams = httpParams.set(k, params[k]);
      }
    });
    return this.http.get<any>(this.base, { params: httpParams }).pipe(
      map(res => Array.isArray(res) ? res : (res?.results ?? []))
    );
  }

  listBySsdgps(ssdgpsId: string, showDeleted = false): Observable<Piece[]> {
    return this.list({ ssdgps: ssdgpsId, show_deleted: showDeleted || undefined });
  }

  listBySession(sessionId: string, showDeleted = false): Observable<Piece[]> {
    return this.list({ session: sessionId, show_deleted: showDeleted || undefined });
  }

  /** Récupère une pièce par son id (endpoint retrieve du ModelViewSet) — utile pour
   * l'accès direct (deep-link) à la page d'édition. */
  getById(id: string): Observable<Piece> {
    return this.http.get<Piece>(`${this.base}${id}/`);
  }

  createManual(payload: {
    type_piece: string; parent: PieceParent; numero?: number;
    data: { rows: any[] };
  }): Observable<Piece> {
    return this.http.post<Piece>(this.base, {
      type_piece: payload.type_piece,
      ssdgps: payload.parent.ssdgps || null,
      session: payload.parent.session || null,
      numero: payload.numero ?? null,
      source_saisie: 'manuel',
      payload: payload.data,
    });
  }

  uploadImage(file: File, typePiece: string, parent: PieceParent, numero?: number): Observable<Piece> {
    const formData = new FormData();
    formData.append('type_piece', typePiece);
    if (parent.ssdgps) formData.append('ssdgps', parent.ssdgps);
    if (parent.session) formData.append('session', parent.session);
    if (numero != null) formData.append('numero', String(numero));
    formData.append('source_saisie', 'image');
    formData.append('fichier', file, file.name);
    return this.http.post<Piece>(this.base, formData);
  }

  /** Crée une pièce à base d'image sans fichier (la galerie est alimentée ensuite via addImages). */
  createImagePiece(typePiece: string, parent: PieceParent, numero?: number): Observable<Piece> {
    return this.http.post<Piece>(this.base, {
      type_piece: typePiece,
      ssdgps: parent.ssdgps || null,
      session: parent.session || null,
      numero: numero ?? null,
      source_saisie: 'image',
    });
  }

  /** Ajoute plusieurs images à une pièce ; transmet le lastModified navigateur par fichier.
   * `pointRef` (PPA/PPN) rattache tout le lot à un point. */
  addImages(pieceId: string, files: File[], pointRef?: string): Observable<Piece> {
    const formData = new FormData();
    files.forEach(f => {
      formData.append('fichiers', f, f.name);
      formData.append('last_modified', String(f.lastModified));
    });
    if (pointRef) formData.append('point_ref', pointRef);
    return this.http.post<Piece>(`${this.base}${pieceId}/images/`, formData);
  }

  deleteImage(pieceId: string, imageId: number): Observable<Piece> {
    return this.http.delete<Piece>(`${this.base}${pieceId}/images/${imageId}/`);
  }

  /** (Ré)assigne une photo à un point (PPA/PPN) ; pointRef vide = désassigner. */
  assignImage(pieceId: string, imageId: number, pointRef: string): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${pieceId}/images/${imageId}/assign/`, { point_ref: pointRef });
  }

  /** Affecte en masse plusieurs photos à un point (un seul appel). */
  assignImagesBulk(pieceId: string, imageIds: number[], pointRef: string): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${pieceId}/images/assign-bulk/`, { image_ids: imageIds, point_ref: pointRef });
  }

  reorderImages(pieceId: string, orderedIds: number[]): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${pieceId}/images/reorder/`, { ordered_ids: orderedIds });
  }

  /** Aperçu : parse le rapport HTML TBC (RFB) côté serveur → lignes générées. */
  previewHtmlImport(file: File, typePiece: string): Observable<{ rows: any[]; champs: any[]; total_rows: number }> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    formData.append('type_piece', typePiece);
    return this.http.post<{ rows: any[]; champs: any[]; total_rows: number }>(`${this.base}import-html/`, formData);
  }

  /** Confirmation : crée la pièce RFB à partir du HTML (lignes éditées + fichier attaché). */
  confirmHtmlImport(file: File, typePiece: string, parent: PieceParent, numero: number | undefined, rows: any[]): Observable<Piece> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    formData.append('type_piece', typePiece);
    if (parent.ssdgps) formData.append('ssdgps', parent.ssdgps);
    if (parent.session) formData.append('session', parent.session);
    if (numero != null) formData.append('numero', String(numero));
    formData.append('payload', JSON.stringify({ rows }));
    return this.http.post<Piece>(`${this.base}import-html/`, formData);
  }

  /**
   * Création EN MASSE de pièces répétables (RDN) à partir de plusieurs rapports HTML TBC.
   * L'ordre des fichiers transmis fixe les numéros des déterminations (n° = rang).
   */
  bulkImportHtml(files: File[], typePiece: string, parent: PieceParent): Observable<{ created: Piece[]; count: number }> {
    const formData = new FormData();
    formData.append('type_piece', typePiece);
    if (parent.ssdgps) formData.append('ssdgps', parent.ssdgps);
    if (parent.session) formData.append('session', parent.session);
    for (const f of files) formData.append('fichiers', f, f.name);
    return this.http.post<{ created: Piece[]; count: number }>(`${this.base}import-html-bulk/`, formData);
  }

  /**
   * Aperçu du « Rapport de contrôle » (RC) calculé depuis la LPA + les déterminations
   * du SSDGPS (et de la session si précisée). La source des coordonnées calculées peut être
   * `rdn` (Rapports de la détermination N°k) ou `rdia` (Rapport des déterminations
   * intermédiaires assemblé) ; laisser vide pour la source par défaut (RDN préférée).
   * La réponse expose `source` (source réellement utilisée) et `available_sources` (celles
   * disponibles → si >1, le client peut proposer le choix). Erreur 400 si une source manque.
   */
  previewComputeRc(parent: PieceParent, source?: RcSource):
      Observable<{ rows: any[]; champs: any[]; total_rows: number; source: RcSource; available_sources: RcSource[] }> {
    const formData = new FormData();
    formData.append('type_piece', 'RC');
    if (parent.ssdgps) formData.append('ssdgps', parent.ssdgps);
    if (parent.session) formData.append('session', parent.session);
    if (source) formData.append('source', source);
    return this.http.post<{ rows: any[]; champs: any[]; total_rows: number; source: RcSource; available_sources: RcSource[] }>(
      `${this.base}compute-rc/`, formData);
  }

  /** Création du RC (lignes calculées, éventuellement éditées avant enregistrement). */
  confirmComputeRc(parent: PieceParent, rows: any[], source?: RcSource): Observable<Piece> {
    const formData = new FormData();
    formData.append('type_piece', 'RC');
    if (parent.ssdgps) formData.append('ssdgps', parent.ssdgps);
    if (parent.session) formData.append('session', parent.session);
    if (source) formData.append('source', source);
    formData.append('commit', '1');
    formData.append('payload', JSON.stringify({ rows }));
    return this.http.post<Piece>(`${this.base}compute-rc/`, formData);
  }

  /**
   * Calcule la 2ᵉ version « écarts » d'une pièce RDL/RDN (brute vs détermination
   * définitive). Résultat persisté dans `payload.rows_ecarts`. Erreur 400 si la RDD
   * ou les données brutes manquent.
   */
  computeEcarts(pieceId: string): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${pieceId}/compute-ecarts/`, {});
  }

  /**
   * Aperçu de l'assemblage RDIA (RDL + RDNₖ → une pièce). `sourceIds` (ordonnés) fixe
   * l'ordre des blocs ; vide = toutes les déterminations du scope (RDL puis RDN).
   */
  previewAssembleRdi(parent: PieceParent, sourceIds: string[]):
      Observable<{ rows: any[]; champs: any[]; total_rows: number; sources: any[] }> {
    return this.http.post<{ rows: any[]; champs: any[]; total_rows: number; sources: any[] }>(
      `${this.base}assemble-rdi/`,
      { ssdgps: parent.ssdgps, session: parent.session || null, source_ids: sourceIds });
  }

  /** Crée la pièce RDIA assemblée (lignes éventuellement éditées avant enregistrement). */
  confirmAssembleRdi(parent: PieceParent, sourceIds: string[], rows: any[]): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}assemble-rdi/`, {
      ssdgps: parent.ssdgps, session: parent.session || null,
      source_ids: sourceIds, commit: '1', payload: { rows },
    });
  }

  /** Réassemble une pièce RDIA existante depuis les déterminations du dossier (écarts invalidés). */
  reassembleRdi(pieceId: string): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}assemble-rdi/`, { piece_id: pieceId });
  }

  /**
   * Analyse en masse des fichiers de déterminations (CSV/Excel/HTML) → pour chacun, ses
   * lignes (schéma RDL/RDN) + `has_fixe`. Ne persiste rien ; l'ordre/assemblage est fait
   * ensuite côté client, puis créé/mis à jour via createManual / update.
   */
  parseDeterminations(files: File[]): Observable<{ determinations: Array<{ filename: string; count: number; has_fixe: boolean; fixes: string[]; rows: any[] }> }> {
    const formData = new FormData();
    for (const f of files) formData.append('fichiers', f, f.name);
    return this.http.post<{ determinations: Array<{ filename: string; count: number; has_fixe: boolean; fixes: string[]; rows: any[] }> }>(
      `${this.base}parse-determinations/`, formData);
  }

  /** Ré-import HTML TBC : remplace les données (+ fichier) d'une pièce existante. */
  reimportHtml(pieceId: string, file: File, typePiece: string, rows: any[]): Observable<Piece> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    formData.append('type_piece', typePiece);
    formData.append('piece_id', pieceId);
    formData.append('payload', JSON.stringify({ rows }));
    return this.http.post<Piece>(`${this.base}import-html/`, formData);
  }

  previewImport(file: File, typePiece: string): Observable<PieceImportPreview> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    formData.append('type_piece', typePiece);
    return this.http.post<PieceImportPreview>(`${this.base}import/`, formData);
  }

  confirmImport(
    file: File, typePiece: string, parent: PieceParent,
    mapping: Record<string, string>, numero?: number,
  ): Observable<Piece> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    formData.append('type_piece', typePiece);
    if (parent.ssdgps) formData.append('ssdgps', parent.ssdgps);
    if (parent.session) formData.append('session', parent.session);
    if (numero != null) formData.append('numero', String(numero));
    formData.append('mapping', JSON.stringify(mapping));
    return this.http.post<Piece>(`${this.base}import/`, formData);
  }

  update(id: string, payload: Partial<Piece>): Observable<Piece> {
    return this.http.patch<Piece>(`${this.base}${id}/`, payload);
  }

  replaceFile(id: string, file: File): Observable<Piece> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    return this.http.patch<Piece>(`${this.base}${id}/`, formData);
  }

  reimport(pieceId: string, file: File, typePiece: string, mapping: Record<string, string>): Observable<Piece> {
    const formData = new FormData();
    formData.append('fichier', file, file.name);
    formData.append('type_piece', typePiece);
    formData.append('mapping', JSON.stringify(mapping));
    formData.append('piece_id', pieceId);
    return this.http.post<Piece>(`${this.base}import/`, formData);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}${id}/`);
  }

  restore(id: string): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${id}/restore/`, {});
  }

  bulkRestore(ids: string[]): Observable<{ restored_count: number }> {
    return this.http.post<{ restored_count: number }>(`${this.base}bulk-restore/`, { ids });
  }

  permanentDelete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}${id}/permanent/`);
  }

  bulkPermanentDelete(ids: string[]): Observable<{ deleted_count: number; errors: any[] }> {
    return this.http.post<{ deleted_count: number; errors: any[] }>(`${this.base}permanent-delete/`, { ids });
  }

  reorder(ssdgpsId: string, orderedIds: string[]): Observable<Piece[]> {
    return this.http.post<Piece[]>(`${this.base}reorder/`, { ssdgps: ssdgpsId, ordered_ids: orderedIds });
  }

  moveToPosition(id: string, position: number): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${id}/move/`, { position });
  }

  /**
   * Liste les pièces (portée de l'utilisateur connecté) dont le type possède un tri par
   * défaut configuré et qui ont des données — candidates à l'application du tri sur leur
   * tableau stocké (page « tri des pièces »).
   */
  listSortable(): Observable<{ items: SortablePiece[]; configured_types: string[] }> {
    return this.http.get<{ items: SortablePiece[]; configured_types: string[] }>(
      `${this.base}sortable/`);
  }

  /**
   * Enregistre le tri PROPRE d'une pièce pour UNE version de sa table (dernier tri appliqué —
   * ex. tri manuel par clic sur un en-tête). Suivi par le rapport PDF et l'affichage,
   * indépendamment du tri par défaut du type. Liste vide = retour au tri par défaut du type.
   * `version` : 'brut' (défaut) ou 'ecarts' (pièces RDL/RDN/RDIA).
   */
  setSort(id: string, levels: { field: string; dir: 'asc' | 'desc' }[],
          version: 'brut' | 'ecarts' = 'brut'): Observable<Piece> {
    return this.http.post<Piece>(`${this.base}${id}/set-sort/`, { sort: levels || [], version });
  }

  /**
   * Applique le tri par défaut configuré aux tableaux STOCKÉS des pièces. Passer
   * `pieceIds` pour cibler une/plusieurs pièces, ou rien (`all=true`) pour toutes les
   * pièces des types configurés dans la portée de l'utilisateur.
   */
  applySortConfig(pieceIds?: string[]): Observable<{ updated: number; skipped: number; total: number }> {
    const body = pieceIds && pieceIds.length ? { piece_ids: pieceIds } : { all: true };
    return this.http.post<{ updated: number; skipped: number; total: number }>(
      `${this.base}apply-sort-config/`, body);
  }

  setScope(id: string, sessionId: string | null): Observable<Piece> {
    return this.update(id, { session: sessionId } as Partial<Piece>);
  }

  /** Génère le rapport PDF du SSDGPS (page de garde + pièces valides). Le PDF est
   * renvoyé encodé en base64 dans un JSON (`{filename, content_type, data}`) — et non en
   * flux binaire — pour éviter qu'un gestionnaire de téléchargement externe (IDM…) ne
   * capture la requête XHR. L'appelant reconstruit le Blob puis le télécharge.
   * En vue session (multi-session), passer `sessionId` pour cibler cette session.
   * `duplex` = true : mise en page recto-verso (pages de garde calées sur page droite,
   * identification du pied en miroir, pagination globale côté reliure). */
  /**
   * Rapport PDF d'un SSDGPS.
   *
   * `sessionRange` déclenche le rapport de **synthèse** sur une plage de sessions : les
   * pièces communes n'y figurent qu'une fois, les pièces spécifiques sont regroupées par
   * pièce puis déclinées session par session. Il est exclusif de `sessionId` — le backend
   * refuse les deux ensemble.
   */
  downloadReport(ssdgpsId: string, sessionId?: string | null, duplex = false,
                 sessionRange?: { from: string; to: string } | null):
      Observable<{ filename: string; content_type: string; data: string }> {
    let params = new HttpParams().set('ssdgps', ssdgpsId);
    if (sessionRange) {
      params = params.set('session_from', sessionRange.from)
                     .set('session_to', sessionRange.to);
    } else if (sessionId) {
      params = params.set('session', sessionId);
    }
    if (duplex) params = params.set('duplex', '1');
    return this.http.get<{ filename: string; content_type: string; data: string }>(
      `${this.base}report/`, { params });
  }
}
