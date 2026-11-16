import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CandidatImport {
  type_piece: string;
  libelle: string;
  score: number;
  champs_reconnus: number;
  champs_total: number;
  nom_reconnu: boolean;
  repetable: boolean;
  niveau: string;
  mapping: Record<string, string>;
  numero_nom: number | null;
}

export type ActionImport = 'creer' | 'remplacer' | 'ignorer';

/** Une pièce du plan : un tableau (CSV, feuille Excel) ou un rapport HTML de TBC. */
export interface LignePlan {
  index: number;
  fichier: string;
  mode: 'tableau' | 'html';
  feuille?: string | null;
  nom_rapport?: string;
  lisible: boolean;
  erreur?: string;
  raison?: string;
  colonnes: string[];
  lignes: number;
  candidats: CandidatImport[];
  type_piece: string | null;
  ambigu?: boolean;
  confiance?: number;
  mapping: Record<string, string>;
  numero: number | null;
  piece_existante?: string | null;
  action: ActionImport;
  doublon?: boolean;
}

/** Une image : photo de point (PPA / PPN), canevas ou photo du rapport de consultation. */
export interface ImagePlan {
  index: number;
  fichier: string;
  nature_image: 'photo' | 'plan' | 'document';
  type_piece: string | null;
  point: string;
  raison: string;
  candidats?: string[];
}

export interface PlanImport {
  ssdgps: string;
  nature: string;
  plan: LignePlan[];
  images: ImagePlan[];
  ecartes: { fichier: string; raison: string }[];
  points: { PPA: string[]; PPN: string[] };
  rc_possible: boolean;
  rc_existant: boolean;
  pieces_existantes: Record<string, string>;
}

/** Fichier déposé et son chemin relatif (dossier déposé : « levé/Rapport 1_files/x.html »). */
export interface FichierDepose { fichier: File; chemin: string; }

const EXTENSIONS = /\.(csv|xlsx|html?|jpe?g|png|webp|gif|bmp|tiff?|heic)$/i;

/** Garde les seuls formats utiles à l'import (tableaux, rapports HTML, images). */
export function utile(chemin: string): boolean {
  return EXTENSIONS.test(chemin) && !/(^|\/)saved_resource[^/]*$/i.test(chemin);
}

/** Lit récursivement un dossier glissé-déposé (API FileSystemEntry). */
export function lireEntree(entree: any, prefixe = ''): Promise<FichierDepose[]> {
  if (!entree) return Promise.resolve([]);
  if (entree.isFile) {
    return new Promise(res => entree.file((f: File) => res([{ fichier: f, chemin: prefixe + f.name }]), () => res([])));
  }
  if (entree.isDirectory) {
    const lecteur = entree.createReader();
    const tous: any[] = [];
    return new Promise(res => {
      const lire = () => lecteur.readEntries(async (lot: any[]) => {
        if (lot.length) { tous.push(...lot); lire(); return; }
        const enfants = await Promise.all(tous.map(e => lireEntree(e, `${prefixe}${entree.name}/`)));
        res(enfants.flat());
      }, () => res([]));
      lire();
    });
  }
  return Promise.resolve([]);
}

/** Import en masse : plan proposé par le serveur, puis exécution par les imports unitaires. */
@Injectable({ providedIn: 'root' })
export class ImportMasseService {
  private readonly base = `${environment.apiUrl}/v1/pieces/`;

  constructor(private http: HttpClient) {}

  plan(ssdgpsId: string, depots: FichierDepose[]): Observable<PlanImport> {
    const fd = new FormData();
    fd.append('ssdgps', ssdgpsId);
    depots.forEach(d => fd.append('fichiers', d.fichier, d.fichier.name));
    fd.append('chemins', JSON.stringify(depots.map(d => d.chemin)));
    return this.http.post<PlanImport>(`${this.base}import-plan/`, fd);
  }

  /** Tableau (CSV, feuille Excel) : import unitaire, phase 2 (correspondance fournie). */
  importer(ssdgpsId: string, fichier: File, ligne: LignePlan, sessionId: string | null): Observable<any> {
    const fd = new FormData();
    fd.append('fichier', fichier, fichier.name);
    fd.append('type_piece', ligne.type_piece || '');
    fd.append('mapping', JSON.stringify(ligne.mapping || {}));
    if (ligne.feuille) fd.append('feuille', ligne.feuille);
    this.identite(fd, ssdgpsId, ligne, sessionId);
    return this.http.post(`${this.base}import/`, fd);
  }

  /** Rapport HTML de TBC : le serveur re-lit le fichier (aucune ligne transmise). */
  importerHtml(ssdgpsId: string, fichier: File, ligne: LignePlan, sessionId: string | null): Observable<any> {
    const fd = new FormData();
    fd.append('fichier', fichier, fichier.name);
    fd.append('type_piece', ligne.type_piece || '');
    this.identite(fd, ssdgpsId, ligne, sessionId);
    return this.http.post(`${this.base}import-html/`, fd);
  }

  private identite(fd: FormData, ssdgpsId: string, ligne: LignePlan, sessionId: string | null): void {
    if (ligne.action === 'remplacer' && ligne.piece_existante) {
      fd.append('piece_id', ligne.piece_existante);
    } else {
      fd.append('ssdgps', ssdgpsId);
      if (sessionId) fd.append('session', sessionId);
      if (ligne.numero) fd.append('numero', String(ligne.numero));
    }
  }

  /** Remplace les lignes d'une pièce existante (RC recalculé) ; la version précédente est archivée. */
  remplacerLignes(pieceId: string, rows: any[]): Observable<any> {
    return this.http.patch(`${this.base}${pieceId}/`, { payload: { rows } });
  }
}
