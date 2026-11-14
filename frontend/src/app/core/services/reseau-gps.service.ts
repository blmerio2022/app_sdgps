import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Statut d'un point dans le réseau (`suggere` = emplacement proposé par la variante parfaite). */
export type StatutPoint = 'ancien' | 'nouveau' | 'suggere';
export type TypeReseau = 'anciens' | 'mixte';

/** Point au format de la pièce LPA (+ statut ancien / nouveau). */
export interface PointReseau {
  id?: string;
  nom_point: string;
  x_m: number | null;
  y_m: number | null;
  reference?: string;
  nature_materialisation?: string;
  nature_signalisation?: string;
  statut?: StatutPoint;
  /** Point nouveau : placé par l'opérateur ou proposé par l'application. */
  origine?: 'manuel' | 'propose';
}

export interface PointResultat extends PointReseau {
  index: number;
  lat: number;
  lon: number;
  degre: number;
}

export interface LigneBase {
  de: number; a: number;
  distance_m: number; distance_km: number; azimut_deg: number;
  en_boucle: boolean; trop_longue: boolean;
}

export interface TriangleResultat {
  sommets: number[]; angles_deg: number[];
  angle_min: number; angle_max: number; conforme: boolean; defectueux: boolean;
}

export interface ControleNorme {
  code: string; norme: string; gravite: 'bloquant' | 'majeur' | 'mineur'; ok: boolean; message: string;
}

export interface IndicateursVariante {
  nb_points: number; nb_lignes_base: number; nb_triangles: number;
  angle_min: number; angle_max: number; ecart_equilateral_moyen: number | null;
  taux_triangles_conformes: number; nb_triangles_defectueux: number;
  degre_min: number; degre_moyen: number; nb_points_sous_liaisons: number; taux_points_bien_lies: number;
  redondance: number; taux_lignes_en_boucle: number;
  longueur_max_km: number; longueur_moyenne_km: number; longueur_totale_km: number;
  nb_lignes_trop_longues: number; lignes_par_point: number; connexe: boolean;
  nb_violations_stations_voisines: number;
  quadrants_anciens?: number; nb_nouveaux_hors_enveloppe?: number; nb_nouveaux_mal_rattaches?: number;
  score: number; penalite: number;
}

export interface VarianteReseau {
  code: string; nom: string; description: string;
  indicateurs: IndicateursVariante;
  controles: ControleNorme[];
  admissible: boolean;
  recommandee: boolean;
  lignes: LigneBase[];
  triangles: TriangleResultat[];
  degres: number[];
  violations_stations_voisines: number[][];
}

export interface SuggestionPoint {
  index: number; nom_point: string; x_m: number; y_m: number; lat: number; lon: number;
  rayon_recherche_m: number; motif: string; score_avant: number; score_apres: number; justification: string;
}

export interface VarianteParfaite extends VarianteReseau {
  points: PointResultat[];
  suggestions: SuggestionPoint[];
  conclusion: string;
}

export interface ResultatReseau {
  type_reseau: TypeReseau;
  zone: string;
  longueur_max_km: number;
  points: PointResultat[];
  variantes: VarianteReseau[];
  recommandee: string | null;
  justification: string[];
  parfaite: VarianteParfaite;
  suppressions: SuggestionSuppression[];
}

/** Point ancien dont l'abandon est conseillé (doublon ou point pénalisant). */
export interface SuggestionSuppression {
  index: number; nom_point: string; type: 'proximite' | 'penalisant';
  score_avant: number; score_apres: number; motif: string; justification: string;
}

/** Ligne d'un rapport de contrôle (pièce RC). */
export interface LigneRc {
  id?: string; nom_point_fixe: string; nom_point_calcule: string;
  x_m_fixe?: string | number; y_m_fixe?: string | number; x_m_calcule?: string | number; y_m_calcule?: string | number;
  delta_x_m?: string | number | null; delta_y_m?: string | number | null; delta_d_m?: string | number | null;
}

export interface AnalyseEcarts {
  tolerance_m: number;
  lignes: (LigneRc & { hors_tolerance: boolean })[];
  points: {
    nom_point: string; nb_controles: number; ecart_max_m: number | null; ecart_moyen_m: number | null;
    nb_hors_tolerance: number; incompatible_avec: string[]; homogene: boolean;
  }[];
  homogenes: string[]; non_homogenes: string[]; non_controles: string[];
  nb_lignes: number; nb_hors_tolerance: number; conclusion: string;
}

export interface SourceRc { ssdgps_id: string; piece_id: string; libelle: string; nature_ssdgps: string; nb_lignes: number; }

export interface DemandeDensification {
  anciens: PointReseau[];
  nouveaux: PointReseau[];
  nb_nouveaux: number;
  proposer: boolean;
  zone: string;
  longueur_max_km: number;
  rayon_couverture_km: number;
  points_couverture_min: number;
}

export interface ResultatDensification {
  zone: string;
  points: PointResultat[];
  proposes: number[];
  reseau: Pick<VarianteReseau, 'indicateurs' | 'controles' | 'admissible' | 'lignes' | 'triangles' | 'violations_stations_voisines'>;
  score_reseau: number;
  score: number;
  couverture: { taux: number; rayon_km: number; points_min: number; nb_echantillons: number; pas_m: number; non_couverts: number[][] };
  zone_polygone: number[][];
  conclusion: string;
}

/** Fond de carte du catalogue fourni par l'application. */
export interface FondCatalogue {
  id: string; nom: string; categorie: string; type: 'xyz' | 'wms'; url: string; max_zoom?: number;
  attribution: string; licence: string; description: string; couches?: string; format?: string;
}

export interface NormeReseau { code: string; titre: string; detail: string; source: string; }

export interface ReferentielReseau {
  zones: { code: string; libelle: string; epsg: number }[];
  zone_defaut: string;
  types_reseau: { code: TypeReseau; libelle: string }[];
  variantes: { code: string; nom: string; description: string }[];
  normes: NormeReseau[];
  fonds: {
    categories: { code: string; libelle: string; icone: string }[];
    catalogue: FondCatalogue[];
    par_defaut: string[];
    aide_personnalise: string[];
  };
  defauts: {
    longueur_max_km: number; nb_suggestions_max: number; points_max: number; suggestions_max: number;
    tolerance_rc_m: number; rayon_couverture_km: number; points_couverture_min: number; nouveaux_max: number;
  };
}

export interface SourceLpa { ssdgps_id: string; piece_id: string; libelle: string; nature_ssdgps: string; nb_points: number; }
export interface SourceLpaDetail {
  ssdgps_id: string; libelle: string; nature_ssdgps: string; points: PointReseau[]; zone_proposee: string | null;
}

export interface DemandeReseau {
  points: PointReseau[];
  type_reseau: TypeReseau;
  zone: string;
  longueur_max_km: number;
  nb_suggestions_max: number;
}

/** Module « Réseau de triangulation GPS » (backend `reseaux/`, ouvert à tous les rôles). */
@Injectable({ providedIn: 'root' })
export class ReseauGpsService {
  private url = `${environment.apiUrl}/v1/reseau-gps/`;

  constructor(private http: HttpClient) {}

  referentiel(): Observable<ReferentielReseau> {
    return this.http.get<ReferentielReseau>(`${this.url}referentiel/`);
  }

  generer(demande: DemandeReseau): Observable<ResultatReseau> {
    return this.http.post<ResultatReseau>(`${this.url}generer/`, demande);
  }

  sourcesLpa(): Observable<SourceLpa[]> {
    return this.http.get<SourceLpa[]>(`${this.url}sources-lpa/`);
  }

  sourceLpa(ssdgpsId: string): Observable<SourceLpaDetail> {
    return this.http.get<SourceLpaDetail>(`${this.url}sources-lpa/${ssdgpsId}/`);
  }

  analyserEcarts(lignes: LigneRc[], toleranceM: number, nomsReseau: string[] = []): Observable<AnalyseEcarts> {
    return this.http.post<AnalyseEcarts>(`${this.url}analyser-ecarts/`,
      { lignes, tolerance_m: toleranceM, noms_reseau: nomsReseau });
  }

  sourcesRc(): Observable<SourceRc[]> {
    return this.http.get<SourceRc[]>(`${this.url}sources-rc/`);
  }

  sourceRc(ssdgpsId: string): Observable<{ ssdgps_id: string; libelle: string; lignes: LigneRc[] }> {
    return this.http.get<{ ssdgps_id: string; libelle: string; lignes: LigneRc[] }>(`${this.url}sources-rc/${ssdgpsId}/`);
  }

  densifier(demande: DemandeDensification): Observable<ResultatDensification> {
    return this.http.post<ResultatDensification>(`${this.url}densifier/`, demande);
  }
}
