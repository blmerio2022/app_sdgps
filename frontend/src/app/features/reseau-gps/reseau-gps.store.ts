import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  AnalyseEcarts, FondCatalogue, LigneBase, LigneRc, PointReseau, ReferentielReseau, ReseauGpsService,
  ResultatDensification, ResultatPersonnalise, ResultatReseau, SuggestionSuppression, TypeZone, ZoneImportee,
  EtudeReseau, ModeGenerationZone, ResultatGenerationZone,
} from '../../core/services/reseau-gps.service';
import { ToastService } from '../../core/services/toast.service';
import {
  FondCarte, MesFonds, ajouterDuCatalogue, chargerMesFonds, enregistrerMesFonds, listeMesFonds,
  nouveauFondPersonnel, retirerFond,
} from './fonds-carte';
import { lambertVersWgs84, wgs84VersLambert } from './lambert-maroc';
import { mesurerZone } from './mesures.util';
import { LigneCarte, PointCarte, StylePoint, VueCarte, ZoneCarte } from './reseau-carte/reseau-carte.component';

/**
 * Onglets, dans l'ordre du travail de densification :
 * 1. points anciens disponibles dans la zone ; 2. réseau de contrôle de stabilité
 * (optimisation : points à rechercher / à écarter) ; 3. contrôle des écarts (RC) et points
 * homogènes ; 4. densification (points nouveaux) ; 5. fonds de carte.
 */
export type OngletReseau = 'points' | 'controle' | 'ecarts' | 'densification' | 'zones' | 'fonds';

/** Réseau que l'opérateur peut personnaliser : celui du contrôle, ou celui de la densification. */
export type ContexteReseau = 'controle' | 'densification';

export const COULEURS_ZONES: Record<TypeZone, string> = { levee: '#f39c12', densification: '#8e44ad' };
export const LIBELLES_ZONES: Record<TypeZone, string> = {
  levee: 'Zone levée (lever de détail à couvrir)',
  densification: 'Zone de densification (points nouveaux à y placer)',
};

/** Zone de travail : importée (shapefile / GeoPackage) ou dessinée sur la carte. */
export interface ZoneReseau {
  id: string;
  nom: string;
  type: TypeZone;
  /** Référence libre : n° de titre, d'affaire, de secteur… */
  reference: string;
  description: string;
  couleur: string;
  /** Prise en compte dans la densification (sinon seulement affichée, estompée). */
  active: boolean;
  source: 'import' | 'dessin';
  fichier?: string;
  attributs?: Record<string, string>;
  /** Polygones WGS84 : [anneau extérieur, trous…], anneau = [[lat, lon]…]. */
  polygones: number[][][][];
}

/** Réseau personnalisé : lignes de base choisies par l'opérateur (paires de noms). */
export interface ReseauPerso {
  lignes: [string, string][];
  resultat: ResultatPersonnalise | ResultatDensification | null;
  calcul: boolean;
  erreur: string;
}

/** Délai avant l'évaluation d'un réseau personnalisé (plusieurs clics = un seul calcul). */
export const DELAI_EVALUATION_MS = 350;
/** Délai de l'enregistrement automatique d'une étude après la dernière modification. */
export const DELAI_AUTOSAUVEGARDE_MS = 2500;
export const CLE_AUTOSAUVEGARDE = 'reseauGps.autosauvegarde';
export const VERSION_CONTENU = 1;

/** Sélection faite sur la carte (outils ponctuel, rectangle, polygone, cercle, main levée). */
export interface EvenementSelection {
  points: string[];
  lignes: [string, string][];
  mode: 'remplacer' | 'ajouter' | 'retirer';
}

/** Paramètres de la génération d'un réseau pour une zone. */
export interface ParametresZone {
  zoneId: string | null;
  mode: ModeGenerationZone;
  source: 'actifs' | 'selection';
  rayonRechercheKm: number;
  anciensMax: number;
  nbNouveaux: number;
}

/** Qualification d'un point ancien après observation et analyse des écarts. */
export type QualitePoint = 'a_controler' | 'homogene' | 'non_homogene' | 'instable' | 'non_retrouve';
export const LIBELLES_QUALITE: Record<QualitePoint, string> = {
  a_controler: 'À contrôler', homogene: 'Homogène et stable', non_homogene: 'Non homogène',
  instable: 'Instable', non_retrouve: 'Non retrouvé / détruit',
};
/** Qualités qui excluent un point du groupe d'appui. */
export const QUALITES_A_ECARTER: QualitePoint[] = ['non_homogene', 'instable', 'non_retrouve'];

export interface PointAncien extends PointReseau {
  /** Retenu dans le réseau (l'opérateur peut écarter un point, avec un motif). */
  retenu: boolean;
  motifEcart?: string;
  /** Homogène d'après le contrôle des écarts ; null = pas (encore) contrôlé. */
  homogene: boolean | null;
  qualite?: QualitePoint;
  noteQualite?: string;
}

export interface PointNouveau extends PointReseau {
  origine: 'manuel' | 'propose';
  /** Emplacement de référence (proposé) et rayon dans lequel déplacer le point sans dégrader le réseau. */
  ancre?: { x_m: number; y_m: number };
  rayon_m?: number;
}

/** Version arrêtée du réseau de contrôle, à observer sur le terrain. */
export interface IterationControle {
  numero: number;
  date: string;
  points: string[];
  lignes: [string, string][];
  score: number | null;
  variante: string;
  statut: 'a_observer' | 'observe';
  note: string;
}

const CATALOGUE_VIDE: FondCatalogue[] = [];

const message = (err: any, defaut: string) => {
  const d = err?.error;
  return d?.detail || (d && typeof d === 'object' ? JSON.stringify(d) : defaut);
};

/** État du module « Réseau GNSS », partagé par les onglets et la carte (fourni par la page). */
@Injectable()
export class ReseauGpsStore {
  referentiel: ReferentielReseau | null = null;
  onglet: OngletReseau = 'points';

  // --- 1. Points anciens
  anciens: PointAncien[] = [];
  libelleSource = '';

  // --- paramètres communs
  zone = 'nord';
  longueurMaxKm = 10;

  // --- 2. Réseau de contrôle
  nbSuggestionsMax = 5;
  controle: ResultatReseau | null = null;
  controlePerime = false;
  varianteActive = '';
  calculControle = false;
  erreurControle = '';

  // --- 3. Contrôle des écarts
  lignesRc: LigneRc[] = [];
  libelleRc = '';
  toleranceCm = 15;
  analyse: AnalyseEcarts | null = null;
  calculEcarts = false;
  erreurEcarts = '';

  // --- 4. Densification
  nouveaux: PointNouveau[] = [];
  nbNouveaux = 0;
  rayonCouvertureKm = 5;
  pointsCouvertureMin = 3;
  densification: ResultatDensification | null = null;
  densificationPerimee = false;
  calculDensification = false;
  erreurDensification = '';
  modeAjoutCarte = false;

  // --- 5. Fonds de carte
  mesFonds: MesFonds = { ids: [], persos: [], actif: null };

  // --- Zones (levées / à densifier)
  zones: ZoneReseau[] = [];
  zoneSelectionnee: string | null = null;
  afficherZones = true;
  modeDessinZone = false;
  /** Type donné à la prochaine zone dessinée. */
  typeDessin: TypeZone = 'densification';
  importZonesEnCours = false;
  avertissementsZones: string[] = [];

  // --- Réseaux personnalisés
  perso: Record<ContexteReseau, ReseauPerso | null> = { controle: null, densification: null };
  /** Édition des lignes sur la carte (clic point A puis point B ; clic sur une ligne = la retirer). */
  editionLignes: ContexteReseau | null = null;
  selectionLigne: string | null = null;

  // --- Sélection sur la carte (clés « p:<nom> » et « l:<a>\u0000<b> »)
  selection = new Set<string>();
  readonly cadrerNoms$ = new BehaviorSubject<string[] | null>(null);

  // --- Génération pour une zone
  paramZone: ParametresZone = { zoneId: null, mode: 'triangulation', source: 'actifs', rayonRechercheKm: 5,
                                anciensMax: 12, nbNouveaux: 0 };
  resultatZone: ResultatGenerationZone | null = null;
  calculZone = false;
  erreurZone = '';

  // --- Cycle de contrôle de stabilité et d'homogénéité
  zoneEtudeId: string | null = null;
  iterations: IterationControle[] = [];
  groupeHomogene: { date: string; points: string[] } | null = null;
  /** Recalcule le score après chaque déplacement d'un point nouveau sur la carte. */
  recalculAuto = true;
  private minuteurDeplacement?: ReturnType<typeof setTimeout>;

  // --- Étude enregistrée
  etude: EtudeReseau | null = null;
  modifie = false;
  autosauvegarde = localStorage.getItem(CLE_AUTOSAUVEGARDE) !== '0';
  sauvegardeEnCours = false;
  derniereSauvegarde: Date | null = null;
  erreurSauvegarde = '';
  private chargementEtude = false;
  private minuteurSauvegarde?: ReturnType<typeof setTimeout>;
  private minuteurs: Partial<Record<ContexteReseau, ReturnType<typeof setTimeout>>> = {};

  readonly vue$ = new BehaviorSubject<VueCarte | null>(null);

  constructor(private service: ReseauGpsService, private toast: ToastService) {}

  init(): void {
    this.service.referentiel().subscribe({
      next: r => {
        this.referentiel = r;
        this.zone = r.zone_defaut;
        this.longueurMaxKm = r.defauts.longueur_max_km;
        this.nbSuggestionsMax = r.defauts.nb_suggestions_max;
        this.toleranceCm = Math.round(r.defauts.tolerance_rc_m * 1000) / 10;
        this.rayonCouvertureKm = r.defauts.rayon_couverture_km;
        this.pointsCouvertureMin = r.defauts.points_couverture_min;
        this.mesFonds = chargerMesFonds(r.fonds.par_defaut);
      },
      error: () => this.toast.error('Réseau GNSS', 'Chargement du référentiel impossible.'),
    });
  }

  choisirOnglet(o: OngletReseau): void {
    this.onglet = o;
    if (o !== 'densification') this.modeAjoutCarte = false;
    if (o !== 'zones') this.modeDessinZone = false;
    if (this.editionLignes && this.editionLignes !== o) this.terminerEditionLignes();
    this.rafraichirVue();
  }

  /** Un seul mode de clic actif sur la carte à la fois. */
  arreterModesCarte(): void {
    this.modeAjoutCarte = false;
    this.modeDessinZone = false;
    this.editionLignes = null;
    this.selectionLigne = null;
  }

  // ================================================================== 1. points anciens

  definirAnciens(points: PointReseau[], libelle: string): void {
    this.anciens = points.map(p => ({
      ...p, x_m: ReseauGpsStore.nombre(p.x_m), y_m: ReseauGpsStore.nombre(p.y_m),
      statut: 'ancien', retenu: true, homogene: null,
    }));
    this.libelleSource = libelle;
    this.toutInvalider();
  }

  ajouterAncien(): void {
    this.anciens = [...this.anciens, {
      nom_point: `P${this.anciens.length + 1}`, x_m: null, y_m: null, reference: '',
      nature_materialisation: '', nature_signalisation: '', statut: 'ancien', retenu: true, homogene: null,
    }];
    this.toutInvalider();
  }

  supprimerAncien(i: number): void {
    this.anciens = this.anciens.filter((_, k) => k !== i);
    this.toutInvalider();
  }

  viderAnciens(): void {
    this.anciens = [];
    this.libelleSource = '';
    this.controle = null;
    this.analyse = null;
    this.densification = null;
    this.rafraichirVue();
  }

  /** Écarte (ou réintègre) un point ancien du réseau. */
  basculerRetenu(a: PointAncien, motif = ''): void {
    a.retenu = !a.retenu;
    a.motifEcart = a.retenu ? '' : (motif || 'Écarté par l\'opérateur');
    this.toutInvalider();
  }

  /** Active / désactive tous les points (ou inverse la sélection). */
  activerTous(actif: boolean | 'inverser'): void {
    this.anciens.forEach(a => {
      const cible = actif === 'inverser' ? !a.retenu : actif;
      if (a.retenu !== cible) {
        a.retenu = cible;
        a.motifEcart = cible ? '' : 'Désactivé par l\'opérateur';
      }
    });
    this.toutInvalider();
  }

  /** Bascule un point désigné sur la carte (bouton de sa fiche). */
  basculerRetenuParNom(nom: string): void {
    const a = this.anciens.find(p => p.nom_point === nom);
    if (a) this.basculerRetenu(a, 'Désactivé depuis la carte');
  }

  /** Une saisie a changé : les résultats calculés ne correspondent plus aux données. */
  toutInvalider(): void {
    if (this.controle) this.controlePerime = true;
    if (this.densification) this.densificationPerimee = true;
    (['controle', 'densification'] as ContexteReseau[]).forEach(c => this.persoPointsModifies(c));
    this.rafraichirVue();
  }

  /** Coordonnée lue d'une pièce : « 353 108.16 », « 353 108,16 » (espaces, virgule) → nombre. */
  static nombre(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  static coordonneesValides(p: PointReseau): boolean {
    return p.x_m !== null && p.y_m !== null && p.x_m !== undefined && p.y_m !== undefined
      && isFinite(Number(p.x_m)) && isFinite(Number(p.y_m));
  }

  get anciensRetenus(): PointAncien[] {
    return this.anciens.filter(a => a.retenu && ReseauGpsStore.coordonneesValides(a));
  }

  get nbEcartes(): number { return this.anciens.filter(a => !a.retenu).length; }

  private versApi(p: PointReseau): PointReseau {
    return {
      id: p.id, nom_point: p.nom_point, x_m: Number(p.x_m), y_m: Number(p.y_m), reference: p.reference || '',
      nature_materialisation: p.nature_materialisation || '', nature_signalisation: p.nature_signalisation || '',
      statut: p.statut === 'nouveau' ? 'nouveau' : 'ancien',
      ...(p.origine ? { origine: p.origine } : {}),
    };
  }

  // ================================================================== 2. réseau de contrôle

  get blocageControle(): string | null {
    return this.anciensRetenus.length < 3 ? 'Il faut au moins 3 points anciens retenus avec leurs coordonnées.' : null;
  }

  genererControle(): void {
    if (this.blocageControle || this.calculControle) return;
    this.calculControle = true;
    this.erreurControle = '';
    this.service.generer({
      points: this.anciensRetenus.map(p => this.versApi(p)), type_reseau: 'anciens', zone: this.zone,
      longueur_max_km: Number(this.longueurMaxKm), nb_suggestions_max: Number(this.nbSuggestionsMax),
    }).subscribe({
      next: r => {
        this.controle = r;
        this.controlePerime = false;
        this.calculControle = false;
        this.varianteActive = r.recommandee || r.variantes[0]?.code || 'parfaite';
        this.rafraichirVue();
      },
      error: err => { this.calculControle = false; this.erreurControle = message(err, 'Calcul du réseau impossible.'); },
    });
  }

  choisirVariante(code: string): void {
    this.varianteActive = code;
    this.rafraichirVue();
  }

  /** Applique une proposition de suppression : le point ancien est écarté avec son motif. */
  ecarterSuggestion(s: SuggestionSuppression): void {
    const a = this.anciens.find(p => p.retenu && p.nom_point === s.nom_point);
    if (!a) return;
    a.retenu = false;
    a.motifEcart = s.motif;
    this.toutInvalider();
    this.toast.success('Réseau GNSS', `${s.nom_point} écarté : recalculez le réseau.`);
  }

  // ================================================================== 3. écarts (RC)

  definirRc(lignes: LigneRc[], libelle: string): void {
    this.lignesRc = lignes;
    this.libelleRc = libelle;
    this.analyse = null;
    this.erreurEcarts = '';
  }

  analyserEcarts(): void {
    if (!this.lignesRc.length || this.calculEcarts) return;
    this.calculEcarts = true;
    this.erreurEcarts = '';
    const noms = this.anciensRetenus.map(a => a.nom_point);
    this.service.analyserEcarts(this.lignesRc, Number(this.toleranceCm) / 100, noms).subscribe({
      next: a => {
        this.analyse = a;
        this.calculEcarts = false;
        this.appliquerDetection();
      },
      error: err => { this.calculEcarts = false; this.erreurEcarts = message(err, 'Analyse des écarts impossible.'); },
    });
  }

  /** Reporte la détection automatique sur les points anciens (modifiable ensuite). */
  appliquerDetection(): void {
    if (!this.analyse) return;
    const homogenes = new Set(this.analyse.homogenes);
    const controles = new Set(this.analyse.points.map(p => p.nom_point));
    this.anciens.forEach(a => {
      a.homogene = controles.has(a.nom_point) ? homogenes.has(a.nom_point) : null;
      if (a.homogene !== null) a.qualite = a.homogene ? 'homogene' : 'non_homogene';
    });
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  basculerHomogene(a: PointAncien): void {
    a.homogene = !a.homogene;
    a.qualite = a.homogene ? 'homogene' : 'non_homogene';
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  get nbHomogenes(): number { return this.anciensRetenus.filter(a => a.homogene === true).length; }

  // ================================================================== 4. densification

  /** Points d'appui de la densification : anciens retenus ET homogènes. Sans contrôle des
   *  écarts, tous les anciens retenus (signalé à l'écran). */
  get anciensDensification(): PointAncien[] {
    const retenus = this.anciensRetenus;
    if (this.groupeHomogene) {
      const groupe = new Set(this.groupeHomogene.points);
      return retenus.filter(a => groupe.has(a.nom_point));
    }
    return this.sansControleEcarts ? retenus : retenus.filter(a => a.homogene === true);
  }

  get sansControleEcarts(): boolean {
    return !this.anciensRetenus.some(a => a.homogene !== null);
  }

  get blocageDensification(): string | null {
    return this.anciensDensification.length < 3 ? 'Il faut au moins 3 points anciens homogènes.' : null;
  }

  /** Propose les emplacements : les points placés à la main sont conservés, les
   *  propositions précédentes remplacées. */
  proposerNouveaux(): void {
    this.nouveaux = this.nouveaux.filter(n => n.origine === 'manuel');
    this.lancerDensification(true);
  }

  recalculerDensification(): void { this.lancerDensification(false); }

  /** Rayon de déplacement de chaque point nouveau autour de sa position actuelle. */
  calculerRayons(): void { this.lancerDensification(false, true); }

  private lancerDensification(proposer: boolean, rayons?: boolean): void {
    if (this.blocageDensification || this.calculDensification) return;
    this.calculDensification = true;
    this.erreurDensification = '';
    this.service.densifier({
      anciens: this.anciensDensification.map(p => this.versApi(p)),
      nouveaux: this.nouveaux.filter(n => ReseauGpsStore.coordonneesValides(n))
        .map(n => this.versApi({ ...n, statut: 'nouveau' })),
      nb_nouveaux: Number(this.nbNouveaux) || 0, proposer, zone: this.zone,
      longueur_max_km: Number(this.longueurMaxKm), rayon_couverture_km: Number(this.rayonCouvertureKm),
      points_couverture_min: Number(this.pointsCouvertureMin), ...this.zonesPourCalcul(),
      ...(rayons !== undefined ? { rayons } : {}),
    }).subscribe({
      next: r => {
        this.densification = r;
        this.densificationPerimee = false;
        this.calculDensification = false;
        const avant = new Map(this.nouveaux.map(n => [n.nom_point, n]));
        this.nouveaux = r.points.filter(p => p.statut === 'nouveau').map(p => {
          const x = Math.round(Number(p.x_m) * 100) / 100, y = Math.round(Number(p.y_m) * 100) / 100;
          const prec = avant.get(p.nom_point);
          const rayon = p.rayon_deplacement_m;
          // Nouveau rayon calculé : l'emplacement actuel devient la référence ; sinon on garde l'ancienne.
          const ancre = rayon !== undefined ? { x_m: x, y_m: y } : prec?.ancre;
          return {
            ...p, statut: 'nouveau', origine: p.origine === 'propose' ? 'propose' : 'manuel', x_m: x, y_m: y,
            ancre, rayon_m: rayon !== undefined ? rayon : prec?.rayon_m,
          } as PointNouveau;
        });
        this.rafraichirVue();
      },
      error: err => {
        this.calculDensification = false;
        this.erreurDensification = message(err, 'Densification impossible.');
      },
    });
  }

  private nomNouveau(): string {
    const pris = new Set([...this.anciens, ...this.nouveaux].map(p => p.nom_point));
    let k = this.nouveaux.length + 1;
    while (pris.has(`PN${k}`)) k++;
    return `PN${k}`;
  }

  ajouterNouveau(x: number | null = null, y: number | null = null): void {
    this.nouveaux = [...this.nouveaux, {
      nom_point: this.nomNouveau(), x_m: x, y_m: y, statut: 'nouveau', origine: 'manuel',
      reference: '', nature_materialisation: '', nature_signalisation: '',
    }];
    this.nouveauxModifies();
  }

  /** Clic sur la carte en mode « placer un point nouveau ». */
  ajouterNouveauDepuisCarte(lat: number, lon: number): void {
    const [x, y] = wgs84VersLambert(lat, lon, this.zone);
    this.ajouterNouveau(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  }

  supprimerNouveau(i: number): void {
    this.nouveaux = this.nouveaux.filter((_, k) => k !== i);
    this.nouveauxModifies();
  }

  nouveauxModifies(): void {
    if (this.densification) this.densificationPerimee = true;
    this.persoPointsModifies('densification');
    this.rafraichirVue();
  }


  // ================================================================== zones

  private idZone(): string { return `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

  private nomZoneLibre(base = 'Zone'): string {
    const pris = new Set(this.zones.map(z => z.nom));
    let k = this.zones.length + 1;
    while (pris.has(`${base} ${k}`)) k++;
    return `${base} ${k}`;
  }

  importerZones(fichiers: File[], typeDefaut: TypeZone | null): void {
    if (!fichiers.length || this.importZonesEnCours) return;
    this.importZonesEnCours = true;
    this.service.importerZones(fichiers, this.zone, typeDefaut).subscribe({
      next: r => {
        this.importZonesEnCours = false;
        const nouvelles = r.zones.map(z => this.depuisImport(z, typeDefaut));
        this.zones = [...this.zones, ...nouvelles];
        if (!this.zoneEtude && nouvelles.length) this.definirZoneEtude(nouvelles[0].id);
        const supposees = r.projections.filter(p => p.supposee)
          .map(p => `« ${p.couche} » : projection non indiquée, ${p.libelle} supposée.`);
        this.avertissementsZones = [...r.avertissements, ...supposees];
        const aVerifier = nouvelles.filter((_, k) => !r.zones[k].type_deduit).length;
        this.toast.success('Réseau GNSS', `${nouvelles.length} zone(s) importée(s)`
          + (aVerifier ? ` — ${aVerifier} dont le type est à vérifier.` : '.'));
        this.zonesModifiees();
        this.cadrerZones$.next(nouvelles.map(z => z.id));
      },
      error: err => {
        this.importZonesEnCours = false;
        this.toast.error('Import des zones', message(err, 'Lecture des fichiers impossible.'));
      },
    });
  }

  private depuisImport(z: ZoneImportee, typeDefaut: TypeZone | null): ZoneReseau {
    const type: TypeZone = z.type || typeDefaut || 'densification';
    const attr = z.attributs || {};
    const cle = (noms: string[]) => Object.keys(attr).find(k => noms.includes(k.toLowerCase()));
    const ref = cle(['reference', 'ref', 'titre', 'affaire', 'numero', 'num']);
    const desc = cle(['description', 'observation', 'observations', 'commentaire', 'remarque']);
    return {
      id: this.idZone(), nom: z.nom || this.nomZoneLibre(), type, couleur: COULEURS_ZONES[type], active: true,
      reference: ref ? attr[ref] : '', description: desc ? attr[desc] : '',
      source: 'import', fichier: z.couche && z.fichier !== `${z.couche}.shp` ? `${z.fichier} › ${z.couche}` : z.fichier,
      attributs: attr, polygones: z.polygones,
    };
  }

  commencerDessinZone(): void {
    this.arreterModesCarte();
    this.modeDessinZone = true;
  }

  /** Fin du tracé sur la carte : anneau [[lat, lon]…] (au moins 3 sommets). */
  ajouterZoneDessinee(anneau: number[][]): void {
    this.modeDessinZone = false;
    if (anneau.length < 3) return;
    const zone: ZoneReseau = {
      id: this.idZone(), nom: this.nomZoneLibre(), type: this.typeDessin, couleur: COULEURS_ZONES[this.typeDessin],
      active: true, reference: '', description: '', source: 'dessin', polygones: [[anneau]],
    };
    this.zones = [...this.zones, zone];
    this.zoneSelectionnee = zone.id;
    if (!this.zoneEtude) this.definirZoneEtude(zone.id);
    this.onglet = 'zones';
    this.zonesModifiees();
    this.toast.success('Réseau GNSS', `${zone.nom} ajoutée : nommez-la et vérifiez son type.`);
  }

  changerTypeZone(z: ZoneReseau, type: TypeZone): void {
    if (z.couleur === COULEURS_ZONES[z.type]) z.couleur = COULEURS_ZONES[type];
    z.type = type;
    this.zonesModifiees();
  }

  supprimerZone(id: string): void {
    this.zones = this.zones.filter(z => z.id !== id);
    if (this.zoneEtudeId === id) this.zoneEtudeId = this.zones[0]?.id ?? null;
    if (this.zoneSelectionnee === id) this.zoneSelectionnee = null;
    this.zonesModifiees();
  }

  viderZones(): void {
    this.zones = [];
    this.zoneEtudeId = null;
    this.zoneSelectionnee = null;
    this.avertissementsZones = [];
    this.zonesModifiees();
  }

  selectionnerZone(id: string | null): void {
    this.zoneSelectionnee = id;
    if (id) this.cadrerZones$.next([id]);
    this.rafraichirVue();
  }

  /** Une zone a changé : la densification qui en dépend est à recalculer. */
  zonesModifiees(): void {
    if (this.densification) this.densificationPerimee = true;
    this.persoPointsModifies('densification');
    this.rafraichirVue();
  }

  mesuresZone(z: ZoneReseau): { aire: number; perimetre: number; sommets: number } {
    return mesurerZone(z.polygones, this.zone);
  }

  zonesActives(type: TypeZone): ZoneReseau[] { return this.zones.filter(z => z.active && z.type === type); }

  /** Zones actives converties en Lambert pour le calcul de densification. */
  zonesPourCalcul(): { zones_densification: number[][][][]; zones_levee: number[][][][] } {
    const plan = (zs: ZoneReseau[]) => zs.flatMap(z => z.polygones.map(poly => poly.map(anneau =>
      anneau.map(([lat, lon]) => wgs84VersLambert(lat, lon, this.zone).map(v => Math.round(v * 100) / 100)))));
    return { zones_densification: plan(this.zonesActives('densification')), zones_levee: plan(this.zonesActives('levee')) };
  }

  /** Zones au format GeoJSON (WGS84, ordre lon/lat), avec leurs informations. */
  exporterGeoJson(): string {
    return JSON.stringify({
      type: 'FeatureCollection',
      features: this.zones.map(z => ({
        type: 'Feature',
        properties: { nom: z.nom, type: z.type, reference: z.reference, description: z.description,
                      source: z.source, fichier: z.fichier || '', aire_m2: Math.round(this.mesuresZone(z).aire) },
        geometry: {
          type: 'MultiPolygon',
          coordinates: z.polygones.map(poly => poly.map(anneau => {
            const ferme = [...anneau, anneau[0]];
            return ferme.map(([lat, lon]) => [lon, lat]);
          })),
        },
      })),
    }, null, 1);
  }

  /** Zones à recadrer sur la carte (import, sélection). */
  readonly cadrerZones$ = new BehaviorSubject<string[] | null>(null);

  // ================================================================== réseaux personnalisés

  /** Points du réseau personnalisable, dans l'ordre envoyé au calcul. */
  pointsContexte(ctx: ContexteReseau): PointReseau[] {
    return ctx === 'controle'
      ? this.anciensRetenus
      : [...this.anciensDensification, ...this.nouveaux.filter(n => ReseauGpsStore.coordonneesValides(n))];
  }

  nomsContexte(ctx: ContexteReseau): string[] { return this.pointsContexte(ctx).map(p => p.nom_point); }

  /** Démarre un réseau personnalisé à partir des lignes du réseau affiché. */
  personnaliser(ctx: ContexteReseau): void {
    let lignes: [string, string][] = [];
    if (ctx === 'controle' && this.controle && !this.controlePerime) {
      const code = this.varianteActive === 'parfaite' || this.varianteActive === 'personnalise'
        ? (this.controle.recommandee || this.controle.variantes[0]?.code) : this.varianteActive;
      const v = this.controle.variantes.find(x => x.code === code) || this.controle.variantes[0];
      const noms = this.controle.points.map(p => p.nom_point);
      lignes = (v?.lignes || []).map(l => [noms[l.de], noms[l.a]] as [string, string]);
    } else if (ctx === 'densification' && this.densification && !this.densificationPerimee) {
      const noms = this.densification.points.map(p => p.nom_point);
      lignes = this.densification.reseau.lignes.map(l => [noms[l.de], noms[l.a]] as [string, string]);
    }
    this.perso[ctx] = { lignes, resultat: null, calcul: false, erreur: '' };
    if (ctx === 'controle') this.varianteActive = 'personnalise';
    this.evaluerPerso(ctx, true);
    this.rafraichirVue();
  }

  abandonnerPerso(ctx: ContexteReseau): void {
    this.perso[ctx] = null;
    if (this.editionLignes === ctx) this.terminerEditionLignes();
    if (ctx === 'controle' && this.varianteActive === 'personnalise') {
      this.varianteActive = this.controle?.recommandee || this.controle?.variantes[0]?.code || '';
    }
    this.rafraichirVue();
  }

  commencerEditionLignes(ctx: ContexteReseau): void {
    if (!this.perso[ctx]) this.personnaliser(ctx);
    this.arreterModesCarte();
    this.editionLignes = ctx;
    if (ctx === 'controle') this.varianteActive = 'personnalise';
    this.rafraichirVue();
  }

  terminerEditionLignes(): void {
    this.editionLignes = null;
    this.selectionLigne = null;
    this.rafraichirVue();
  }

  private static cleLigne(a: string, b: string): string { return [a, b].sort().join('\u0000'); }

  aLaLigne(ctx: ContexteReseau, a: string, b: string): boolean {
    const cle = ReseauGpsStore.cleLigne(a, b);
    return !!this.perso[ctx]?.lignes.some(([x, y]) => ReseauGpsStore.cleLigne(x, y) === cle);
  }

  /** Ajoute la ligne A–B si elle manque, la retire sinon. */
  basculerLigne(ctx: ContexteReseau, a: string, b: string): void {
    const p = this.perso[ctx];
    if (!p || a === b) return;
    const cle = ReseauGpsStore.cleLigne(a, b);
    const avant = p.lignes.length;
    p.lignes = p.lignes.filter(([x, y]) => ReseauGpsStore.cleLigne(x, y) !== cle);
    if (p.lignes.length === avant) p.lignes = [...p.lignes, [a, b]];
    this.lignesModifiees(ctx);
  }

  ajouterLigne(ctx: ContexteReseau, a: string, b: string): boolean {
    const p = this.perso[ctx];
    if (!p) return false;
    if (!a || !b || a === b) { this.toast.error('Ligne de base', 'Choisissez deux points différents.'); return false; }
    if (this.aLaLigne(ctx, a, b)) { this.toast.error('Ligne de base', `La ligne ${a} – ${b} existe déjà.`); return false; }
    p.lignes = [...p.lignes, [a, b]];
    this.lignesModifiees(ctx);
    return true;
  }

  supprimerLigne(ctx: ContexteReseau, k: number): void {
    const p = this.perso[ctx];
    if (!p) return;
    p.lignes = p.lignes.filter((_, i) => i !== k);
    this.lignesModifiees(ctx);
  }

  /** Change une extrémité d'une ligne existante (refusé si la ligne obtenue existe déjà). */
  modifierLigne(ctx: ContexteReseau, k: number, a: string, b: string): boolean {
    const p = this.perso[ctx];
    if (!p || !p.lignes[k]) return false;
    if (a === b) { this.toast.error('Ligne de base', 'Une ligne relie deux points différents.'); return false; }
    const cle = ReseauGpsStore.cleLigne(a, b);
    if (p.lignes.some(([x, y], i) => i !== k && ReseauGpsStore.cleLigne(x, y) === cle)) {
      this.toast.error('Ligne de base', `La ligne ${a} – ${b} existe déjà.`);
      return false;
    }
    p.lignes = p.lignes.map((l, i) => (i === k ? [a, b] as [string, string] : l));
    this.lignesModifiees(ctx);
    return true;
  }

  /** Clic sur un point en mode édition : 1er clic = départ, 2e clic = bascule de la ligne. */
  clicPointEdition(nom: string): void {
    const ctx = this.editionLignes;
    if (!ctx) return;
    if (!this.selectionLigne) this.selectionLigne = nom;
    else if (this.selectionLigne === nom) this.selectionLigne = null;
    else {
      this.basculerLigne(ctx, this.selectionLigne, nom);
      this.selectionLigne = null;
    }
    this.rafraichirVue();
  }

  /** Clic sur une ligne en mode édition : elle est retirée. */
  clicLigneEdition(a: string, b: string): void {
    if (this.editionLignes) this.basculerLigne(this.editionLignes, a, b);
  }

  private lignesModifiees(ctx: ContexteReseau): void {
    this.evaluerPerso(ctx);
    this.rafraichirVue();
  }

  /** Points modifiés : les lignes vers un point disparu tombent, le réseau est réévalué. */
  private persoPointsModifies(ctx: ContexteReseau): void {
    const p = this.perso[ctx];
    if (!p) return;
    const noms = new Set(this.nomsContexte(ctx));
    p.lignes = p.lignes.filter(([a, b]) => noms.has(a) && noms.has(b));
    this.evaluerPerso(ctx);
  }

  evaluerPerso(ctx: ContexteReseau, immediat = false): void {
    const p = this.perso[ctx];
    if (!p) return;
    clearTimeout(this.minuteurs[ctx]);
    p.calcul = true;
    const lancer = () => {
      const pts = this.pointsContexte(ctx);
      if (pts.length < 3) {
        p.calcul = false;
        p.resultat = null;
        p.erreur = 'Il faut au moins 3 points actifs.';
        return;
      }
      const fin = (r: ResultatPersonnalise | ResultatDensification) => {
        if (this.perso[ctx] !== p) return;
        p.resultat = r; p.calcul = false; p.erreur = '';
        this.redessiner();
      };
      const echec = (err: any) => {
        if (this.perso[ctx] !== p) return;
        p.calcul = false; p.resultat = null;
        p.erreur = message(err, 'Évaluation du réseau personnalisé impossible.');
        this.redessiner();
      };
      if (ctx === 'controle') {
        this.service.evaluer({
          points: pts.map(x => this.versApi(x)), lignes: p.lignes.map(l => [...l]), type_reseau: 'anciens',
          zone: this.zone, longueur_max_km: Number(this.longueurMaxKm),
        }).subscribe({ next: fin, error: echec });
      } else {
        const index = new Map(pts.map((x, i) => [x.nom_point, i]));
        const nbAnciens = this.anciensDensification.length;
        this.service.densifier({
          anciens: pts.slice(0, nbAnciens).map(x => this.versApi(x)),
          nouveaux: pts.slice(nbAnciens).map(x => this.versApi({ ...x, statut: 'nouveau' })),
          nb_nouveaux: 0, proposer: false, zone: this.zone, longueur_max_km: Number(this.longueurMaxKm),
          rayon_couverture_km: Number(this.rayonCouvertureKm), points_couverture_min: Number(this.pointsCouvertureMin),
          ...this.zonesPourCalcul(),
          lignes: p.lignes.map(([a, b]) => [index.get(a)!, index.get(b)!]),
        }).subscribe({ next: fin, error: echec });
      }
    };
    if (immediat) lancer();
    else this.minuteurs[ctx] = setTimeout(lancer, DELAI_EVALUATION_MS);
  }

  /** Score du réseau personnalisé (réseau seul pour le contrôle, densification sinon). */
  scorePerso(ctx: ContexteReseau): number | null {
    const r = this.perso[ctx]?.resultat;
    if (!r) return null;
    return 'score' in r && typeof (r as ResultatDensification).score === 'number' && ctx === 'densification'
      ? (r as ResultatDensification).score : (r as ResultatPersonnalise).indicateurs?.score ?? null;
  }



  // ================================================================== cycle de contrôle

  get zoneEtude(): ZoneReseau | undefined { return this.zones.find(z => z.id === this.zoneEtudeId); }

  /** Zone de l'étude : celle du réseau de contrôle et de la densification. */
  definirZoneEtude(id: string | null): void {
    this.zoneEtudeId = id;
    if (id) this.paramZone = { ...this.paramZone, zoneId: id };
    this.rafraichirVue();
  }

  /** Qualifie un point après analyse des écarts (synchronise `homogene`). */
  qualifier(a: PointAncien, q: QualitePoint): void {
    a.qualite = q;
    a.homogene = q === 'homogene' ? true : q === 'a_controler' ? null : false;
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  qualiteDe(a: PointAncien): QualitePoint {
    if (a.qualite) return a.qualite;
    return a.homogene === true ? 'homogene' : a.homogene === false ? 'non_homogene' : 'a_controler';
  }

  compteQualites(): Record<QualitePoint, number> {
    const c: Record<QualitePoint, number> = { a_controler: 0, homogene: 0, non_homogene: 0, instable: 0, non_retrouve: 0 };
    this.anciensRetenus.forEach(a => c[this.qualiteDe(a)]++);
    return c;
  }

  /** Désactive les points actifs non homogènes, instables ou non retrouvés. */
  desactiverNonConformes(): number {
    let n = 0;
    this.anciens.forEach(a => {
      const q = this.qualiteDe(a);
      if (a.retenu && QUALITES_A_ECARTER.includes(q)) {
        a.retenu = false;
        a.motifEcart = `${LIBELLES_QUALITE[q]}${a.noteQualite ? ' — ' + a.noteQualite : ''}`;
        n++;
      }
    });
    if (n) this.toutInvalider();
    return n;
  }

  /** Lignes (noms) du réseau de contrôle affiché : personnalisé ou variante choisie. */
  lignesReseauControle(): { lignes: [string, string][]; score: number | null; variante: string } {
    if (this.varianteActive === 'personnalise' && this.perso.controle) {
      return { lignes: [...this.perso.controle.lignes], score: this.scorePerso('controle'), variante: 'Réseau personnalisé' };
    }
    const r = this.controle;
    if (!r || this.controlePerime) return { lignes: [], score: null, variante: '' };
    const v = r.variantes.find(x => x.code === this.varianteActive) || r.variantes.find(x => x.recommandee) || r.variantes[0];
    const noms = r.points.map(p => p.nom_point);
    return { lignes: v.lignes.map(l => [noms[l.de], noms[l.a]] as [string, string]), score: v.indicateurs.score, variante: v.nom };
  }

  get blocageArret(): string | null {
    if (this.varianteActive === 'parfaite') return 'La variante parfaite contient des emplacements à rechercher : choisissez une autre variante.';
    return this.lignesReseauControle().lignes.length ? null : 'Générez (ou personnalisez) d’abord le réseau de contrôle.';
  }

  /** Arrête le réseau affiché : nouvelle itération à observer sur le terrain. */
  arreterReseau(note = ''): IterationControle | null {
    if (this.blocageArret) return null;
    const { lignes, score, variante } = this.lignesReseauControle();
    const noms = new Set(lignes.flat());
    const it: IterationControle = {
      numero: this.iterations.length + 1, date: new Date().toISOString(), lignes, score, variante,
      points: this.anciensRetenus.map(a => a.nom_point).filter(n => noms.has(n)), statut: 'a_observer', note,
    };
    this.iterations = [...this.iterations, it];
    this.rafraichirVue();
    this.toast.success('Réseau de contrôle', `Itération n°${it.numero} arrêtée : ${it.lignes.length} ligne(s) de base à observer.`);
    return it;
  }

  marquerObservee(it: IterationControle, observee = true): void {
    it.statut = observee ? 'observe' : 'a_observer';
    this.iterations = [...this.iterations];
    this.rafraichirVue();
  }

  supprimerIteration(it: IterationControle): void {
    this.iterations = this.iterations.filter(x => x !== it).map((x, k) => ({ ...x, numero: k + 1 }));
    this.rafraichirVue();
  }

  /** Lignes déjà observées lors des itérations précédant `numero` (toutes si omis). */
  lignesObservees(avant?: number): Set<string> {
    return new Set(this.iterations.filter(it => it.statut === 'observe' && (avant === undefined || it.numero < avant))
      .flatMap(it => it.lignes.map(([a, b]) => ReseauGpsStore.cleLigne(a, b))));
  }

  /** Observations complémentaires d'une itération : ses lignes jamais observées auparavant. */
  lignesComplementaires(it: IterationControle): [string, string][] {
    const vues = this.lignesObservees(it.numero);
    return it.lignes.filter(([a, b]) => !vues.has(ReseauGpsStore.cleLigne(a, b)));
  }

  /** CSV terrain (Excel FR) : points ou lignes de base d'une itération. */
  csvIteration(it: IterationControle, quoi: 'points' | 'lignes'): string {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    if (quoi === 'points') {
      const par = new Map(this.anciens.map(a => [a.nom_point, a]));
      return '\uFEFF' + ['Nom Point;X(m);Y(m);Référence;Matérialisation;Signalisation;Qualité',
        ...it.points.map(n => par.get(n)).filter((a): a is PointAncien => !!a).map(a => [a.nom_point, a.x_m, a.y_m,
          a.reference, a.nature_materialisation, a.nature_signalisation, LIBELLES_QUALITE[this.qualiteDe(a)]].map(q).join(';')),
      ].join('\r\n');
    }
    const xy = new Map(this.anciens.map(a => [a.nom_point, a]));
    const comp = new Set(this.lignesComplementaires(it).map(([a, b]) => ReseauGpsStore.cleLigne(a, b)));
    return '\uFEFF' + ['De;Vers;Distance (km);À observer',
      ...it.lignes.map(([a, b]) => {
        const p = xy.get(a), r = xy.get(b);
        const d = p && r ? Math.hypot(Number(p.x_m) - Number(r.x_m), Number(p.y_m) - Number(r.y_m)) / 1000 : null;
        return [a, b, d === null ? '' : d.toFixed(3).replace('.', ','),
                comp.has(ReseauGpsStore.cleLigne(a, b)) ? 'Oui' : 'Non (déjà observée)'].map(q).join(';');
      }),
    ].join('\r\n');
  }

  /** Points actifs homogènes et stables (candidats au groupe d'appui). */
  get anciensHomogenes(): PointAncien[] {
    return this.anciensRetenus.filter(a => this.qualiteDe(a) === 'homogene');
  }

  get blocageGroupe(): string | null {
    return this.anciensHomogenes.length < 3 ? 'Il faut au moins 3 points actifs qualifiés « homogènes et stables ».' : null;
  }

  /** Arrête le groupe de points anciens homogènes : appui de la densification. */
  validerGroupeHomogene(): void {
    if (this.blocageGroupe) return;
    this.groupeHomogene = { date: new Date().toISOString(), points: this.anciensHomogenes.map(a => a.nom_point) };
    if (this.densification) this.densificationPerimee = true;
    this.toast.success('Réseau GNSS', `Groupe de ${this.groupeHomogene.points.length} points homogènes validé : passez à la densification.`);
    this.choisirOnglet('densification');
  }

  annulerGroupeHomogene(): void {
    this.groupeHomogene = null;
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  /** Membres du groupe validé dont la qualification a changé depuis. */
  get groupeAltere(): string[] {
    if (!this.groupeHomogene) return [];
    const par = new Map(this.anciens.map(a => [a.nom_point, a]));
    return this.groupeHomogene.points.filter(n => {
      const a = par.get(n);
      return !a || !a.retenu || this.qualiteDe(a) !== 'homogene';
    });
  }

  // ================================================================== points nouveaux : déplacement

  /** Déplacement d'un point nouveau sur la carte (glisser-déposer). */
  deplacerNouveau(nom: string, lat: number, lon: number): void {
    const n = this.nouveaux.find(p => p.nom_point === nom);
    if (!n) return;
    const [x, y] = wgs84VersLambert(lat, lon, this.zone);
    n.x_m = Math.round(x * 100) / 100;
    n.y_m = Math.round(y * 100) / 100;
    this.nouveauxModifies();
    if (this.recalculAuto && this.densification && !this.perso.densification) {
      clearTimeout(this.minuteurDeplacement);
      this.minuteurDeplacement = setTimeout(() => this.recalculerDensification(), 400);
    }
  }

  /** Distance (m) à l'emplacement proposé, ou null sans référence. */
  ecartAncre(n: PointNouveau): number | null {
    if (!n.ancre || !ReseauGpsStore.coordonneesValides(n)) return null;
    return Math.hypot(Number(n.x_m) - n.ancre.x_m, Number(n.y_m) - n.ancre.y_m);
  }

  horsRayon(n: PointNouveau): boolean {
    const e = this.ecartAncre(n);
    return e !== null && n.rayon_m !== undefined && e > n.rayon_m + 0.01;
  }

  recentrer(n: PointNouveau): void {
    if (!n.ancre) return;
    n.x_m = n.ancre.x_m;
    n.y_m = n.ancre.y_m;
    this.nouveauxModifies();
  }

  // ================================================================== sélection et actions en masse

  static cleLigneSel(a: string, b: string): string { return 'l:' + [a, b].sort().join('\u0000'); }

  appliquerSelection(e: EvenementSelection): void {
    const cles = [...e.points.map(n => 'p:' + n), ...e.lignes.map(([a, b]) => ReseauGpsStore.cleLigneSel(a, b))];
    if (e.mode === 'remplacer') this.selection = new Set(cles);
    else if (e.mode === 'ajouter') cles.forEach(k => this.selection.add(k));
    else cles.forEach(k => this.selection.delete(k));
    this.selection = new Set(this.selection);
    this.vue$.next(this.construireVue());
  }

  viderSelection(): void {
    if (!this.selection.size) return;
    this.selection = new Set();
    this.vue$.next(this.construireVue());
  }

  /** Tous les points affichés (ou inverse la sélection des points). */
  selectionnerTout(inverser = false): void {
    const noms = (this.vue$.value?.points || []).map(p => p.nom_point);
    const pts = new Set(noms.map(n => 'p:' + n));
    const garde = [...this.selection].filter(k => !k.startsWith('p:'));
    const choisis = inverser ? [...pts].filter(k => !this.selection.has(k)) : [...pts];
    this.selection = new Set([...garde, ...choisis]);
    this.vue$.next(this.construireVue());
  }

  get nomsSelectionnes(): string[] {
    return [...this.selection].filter(k => k.startsWith('p:')).map(k => k.slice(2));
  }

  get anciensSelectionnes(): PointAncien[] {
    const noms = new Set(this.nomsSelectionnes);
    return this.anciens.filter(a => noms.has(a.nom_point));
  }

  get nouveauxSelectionnes(): PointNouveau[] {
    const noms = new Set(this.nomsSelectionnes);
    return this.nouveaux.filter(n => noms.has(n.nom_point));
  }

  get lignesSelectionnees(): [string, string][] {
    return [...this.selection].filter(k => k.startsWith('l:'))
      .map(k => k.slice(2).split('\u0000') as [string, string]);
  }

  /** Les éléments disparus (point supprimé, réseau recalculé) quittent la sélection. */
  private nettoyerSelection(): void {
    if (!this.selection.size) return;
    const noms = new Set([...this.anciens, ...this.nouveaux].map(p => p.nom_point));
    for (const k of [...this.selection]) {
      if (k.startsWith('p:') && !noms.has(k.slice(2))) this.selection.delete(k);
      if (k.startsWith('l:') && k.slice(2).split('\u0000').some(n => !noms.has(n))) this.selection.delete(k);
    }
  }

  activerSelection(actif: boolean): void {
    let n = 0;
    this.anciensSelectionnes.forEach(a => {
      if (a.retenu !== actif) {
        a.retenu = actif;
        a.motifEcart = actif ? '' : 'Désactivé (sélection sur la carte)';
        n++;
      }
    });
    if (n) this.toutInvalider();
    this.toast.success('Sélection', `${n} point(s) ${actif ? 'activé(s)' : 'désactivé(s)'}.`);
  }

  marquerHomogeneSelection(homogene: boolean): void {
    this.anciensSelectionnes.forEach(a => { a.homogene = homogene; a.qualite = homogene ? 'homogene' : 'non_homogene'; });
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  /** Retire de la liste les points anciens et nouveaux sélectionnés. */
  supprimerSelection(): number {
    const noms = new Set(this.nomsSelectionnes);
    const avant = this.anciens.length + this.nouveaux.length;
    this.anciens = this.anciens.filter(a => !noms.has(a.nom_point));
    this.nouveaux = this.nouveaux.filter(p => !noms.has(p.nom_point));
    const n = avant - this.anciens.length - this.nouveaux.length;
    this.selection = new Set([...this.selection].filter(k => !k.startsWith('p:')));
    this.toutInvalider();
    return n;
  }

  /** Retire du réseau les lignes sélectionnées (le réseau devient personnalisé si besoin). */
  retirerLignesSelection(): number {
    const ctx: ContexteReseau = this.onglet === 'densification' ? 'densification' : 'controle';
    const cles = new Set(this.lignesSelectionnees.map(([a, b]) => ReseauGpsStore.cleLigne(a, b)));
    if (!cles.size) return 0;
    if (!this.perso[ctx]) this.personnaliser(ctx);
    const p = this.perso[ctx]!;
    const avant = p.lignes.length;
    p.lignes = p.lignes.filter(([a, b]) => !cles.has(ReseauGpsStore.cleLigne(a, b)));
    this.selection = new Set([...this.selection].filter(k => !k.startsWith('l:')));
    this.lignesModifiees(ctx);
    return avant - p.lignes.length;
  }

  /** Relie deux à deux les points sélectionnés les plus proches (au plus 3 voisins chacun). */
  relierSelection(): number {
    const ctx: ContexteReseau = this.onglet === 'densification' ? 'densification' : 'controle';
    const pts = this.pointsContexte(ctx).filter(p => this.selection.has('p:' + p.nom_point));
    if (pts.length < 2) return 0;
    if (!this.perso[ctx]) this.personnaliser(ctx);
    const p = this.perso[ctx]!;
    let n = 0;
    for (const a of pts) {
      const voisins = pts.filter(b => b !== a)
        .sort((u, v) => Math.hypot(Number(u.x_m) - Number(a.x_m), Number(u.y_m) - Number(a.y_m))
          - Math.hypot(Number(v.x_m) - Number(a.x_m), Number(v.y_m) - Number(a.y_m))).slice(0, 3);
      for (const b of voisins) {
        if (!this.aLaLigne(ctx, a.nom_point, b.nom_point)) {
          p.lignes = [...p.lignes, [a.nom_point, b.nom_point]];
          n++;
        }
      }
    }
    if (ctx === 'controle') this.varianteActive = 'personnalise';
    this.lignesModifiees(ctx);
    return n;
  }

  cadrerSurSelection(): void { this.cadrerNoms$.next(this.nomsSelectionnes); }

  /** Points sélectionnés au format LPA (CSV Excel : « ; », BOM). */
  selectionEnCsv(): string {
    const lignes = [...this.anciensSelectionnes, ...this.nouveauxSelectionnes].map(p => [
      p.nom_point, p.x_m ?? '', p.y_m ?? '', p.reference || '', p.nature_materialisation || '',
      p.nature_signalisation || '', p.statut === 'nouveau' ? 'nouveau' : 'ancien',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    return '\uFEFF' + ['Nom Point;X(m);Y(m);Référence;Matérialisation;Signalisation;Statut', ...lignes].join('\r\n');
  }

  // ================================================================== génération pour une zone

  get zoneGeneration(): ZoneReseau | undefined {
    return this.zones.find(z => z.id === this.paramZone.zoneId);
  }

  /** Points anciens soumis à la génération : actifs, ou seulement la sélection. */
  get anciensPourZone(): PointAncien[] {
    const base = this.paramZone.source === 'selection' ? this.anciensSelectionnes : this.anciensRetenus;
    return base.filter(a => ReseauGpsStore.coordonneesValides(a));
  }

  get blocageZone(): string | null {
    if (!this.zoneGeneration) return 'Choisissez la zone à traiter (dessinez-la ou importez-la d’abord).';
    if (this.paramZone.source === 'selection' && !this.anciensSelectionnes.length) {
      return 'Aucun point ancien sélectionné sur la carte.';
    }
    if (this.anciensPourZone.length < 3) return 'Il faut au moins 3 points anciens.';
    return null;
  }

  preparerGenerationZone(zoneId: string): void {
    this.paramZone = { ...this.paramZone, zoneId };
    this.resultatZone = null;
    this.erreurZone = '';
    this.paramZone.mode = 'triangulation';
    if (this.onglet !== 'controle') this.choisirOnglet('controle');
    this.cadrerZones$.next([zoneId]);
  }

  genererPourZone(): void {
    const z = this.zoneGeneration;
    if (this.blocageZone || this.calculZone || !z) return;
    this.calculZone = true;
    this.erreurZone = '';
    const plan = z.polygones.map(poly => poly.map(anneau =>
      anneau.map(([lat, lon]) => wgs84VersLambert(lat, lon, this.zone).map(v => Math.round(v * 100) / 100))));
    this.service.genererZone({
      anciens: this.anciensPourZone.map(p => this.versApi(p)), zones: plan, nom_zone: z.nom,
      mode: this.paramZone.mode, zone: this.zone, rayon_recherche_km: Number(this.paramZone.rayonRechercheKm),
      anciens_max: Number(this.paramZone.anciensMax), longueur_max_km: Number(this.longueurMaxKm),
      rayon_couverture_km: Number(this.rayonCouvertureKm), points_couverture_min: Number(this.pointsCouvertureMin),
      nb_nouveaux: Number(this.paramZone.nbNouveaux) || 0, nb_suggestions_max: Number(this.nbSuggestionsMax),
    }).subscribe({
      next: r => { this.resultatZone = r; this.calculZone = false; this.rafraichirVue(); },
      error: err => { this.calculZone = false; this.erreurZone = message(err, 'Génération du réseau impossible.'); },
    });
  }

  /** Aperçu du réseau généré pour la zone (onglet Zones). */
  private vueResultatZone(): VueCarte | null {
    const r = this.resultatZone;
    if (!r) return null;
    const retenus = new Set(r.anciens_retenus);
    const nonRetenus = this.anciens.filter(a => ReseauGpsStore.coordonneesValides(a) && !retenus.has(a.nom_point))
      .map(a => this.pointCarte(a, 'ecarte', { note: r.details.find(d => d.nom_point === a.nom_point)?.motif }));
    if (r.mode === 'triangulation' && r.reseau) {
      const v = r.reseau.variantes.find(x => x.recommandee) || r.reseau.variantes[0];
      return {
        points: [...r.reseau.points.map((pt, i) => ({ ...pt, x_m: Number(pt.x_m), y_m: Number(pt.y_m),
                                                     style: 'ancien' as StylePoint, degre: v.degres[i] })), ...nonRetenus],
        lignes: v.lignes, triangles: v.triangles,
      };
    }
    const d = r.densification!;
    return {
      points: [...d.points.map(p => ({ ...p, x_m: Number(p.x_m), y_m: Number(p.y_m),
        style: (p.statut !== 'nouveau' ? 'homogene' : 'propose') as StylePoint })), ...nonRetenus],
      lignes: d.reseau.lignes, triangles: d.reseau.triangles, nonCouverts: d.couverture.non_couverts,
    };
  }

  /** Applique le résultat : seuls les points retenus restent actifs, puis le réseau s'ouvre
   *  dans l'onglet correspondant (contrôle ou densification). */
  appliquerResultatZone(): void {
    const r = this.resultatZone;
    if (!r) return;
    const retenus = new Set(r.anciens_retenus);
    const sources = new Set(this.anciensPourZone.map(a => a.nom_point));
    this.anciens.forEach(a => {
      if (retenus.has(a.nom_point)) { a.retenu = true; a.motifEcart = ''; }
      else if (sources.has(a.nom_point) || a.retenu) {
        a.retenu = false;
        a.motifEcart = r.details.find(d => d.nom_point === a.nom_point)?.motif || `Non retenu pour ${r.nom_zone}`;
      }
    });
    if (r.mode === 'triangulation' && r.reseau) {
      this.controle = r.reseau;
      this.controlePerime = false;
      this.varianteActive = r.reseau.recommandee || r.reseau.variantes[0]?.code || 'parfaite';
      this.perso.controle = null;
      this.resultatZone = null;
      this.choisirOnglet('controle');
    } else if (r.densification) {
      const d = r.densification;
      this.densification = d;
      this.nouveaux = d.points.filter(p => p.statut === 'nouveau').map(p => ({
        ...p, statut: 'nouveau', origine: 'propose',
        x_m: Math.round(Number(p.x_m) * 100) / 100, y_m: Math.round(Number(p.y_m) * 100) / 100,
      })) as PointNouveau[];
      this.anciens.forEach(a => { if (retenus.has(a.nom_point) && a.homogene === false) a.homogene = null; });
      this.densificationPerimee = false;
      this.perso.densification = null;
      this.resultatZone = null;
      this.choisirOnglet('densification');
    }
    this.toast.success('Réseau GNSS', `Réseau de la zone « ${r.nom_zone} » appliqué.`);
  }

  abandonnerResultatZone(): void {
    this.resultatZone = null;
    this.rafraichirVue();
  }

  // ================================================================== études enregistrées

  /** État complet du module, tel qu'il est enregistré dans une étude. */
  serialiser(): Record<string, any> {
    return {
      version: VERSION_CONTENU,
      onglet: this.onglet, zone: this.zone, longueurMaxKm: this.longueurMaxKm,
      anciens: this.anciens, libelleSource: this.libelleSource,
      nbSuggestionsMax: this.nbSuggestionsMax, controle: this.controle, controlePerime: this.controlePerime,
      varianteActive: this.varianteActive,
      lignesRc: this.lignesRc, libelleRc: this.libelleRc, toleranceCm: this.toleranceCm, analyse: this.analyse,
      nouveaux: this.nouveaux, nbNouveaux: this.nbNouveaux, rayonCouvertureKm: this.rayonCouvertureKm,
      pointsCouvertureMin: this.pointsCouvertureMin, densification: this.densification,
      densificationPerimee: this.densificationPerimee,
      zones: this.zones, typeDessin: this.typeDessin, afficherZones: this.afficherZones,
      perso: { controle: this.perso.controle?.lignes ?? null, densification: this.perso.densification?.lignes ?? null },
      paramZone: this.paramZone, mesFonds: this.mesFonds,
      zoneEtudeId: this.zoneEtudeId, iterations: this.iterations, groupeHomogene: this.groupeHomogene,
      recalculAuto: this.recalculAuto,
    };
  }

  /** Recharge un état enregistré (champs absents : valeurs par défaut). */
  restaurer(c: Record<string, any>): void {
    this.chargementEtude = true;
    try {
      this.arreterModesCarte();
      this.zone = c['zone'] || this.zone;
      this.longueurMaxKm = c['longueurMaxKm'] ?? this.longueurMaxKm;
      this.anciens = (c['anciens'] || []).map((a: any) => ({ ...a, x_m: ReseauGpsStore.nombre(a.x_m),
                                                            y_m: ReseauGpsStore.nombre(a.y_m) }));
      this.libelleSource = c['libelleSource'] || '';
      this.nbSuggestionsMax = c['nbSuggestionsMax'] ?? this.nbSuggestionsMax;
      this.controle = c['controle'] || null;
      this.controlePerime = !!c['controlePerime'];
      this.varianteActive = c['varianteActive'] || '';
      this.lignesRc = c['lignesRc'] || [];
      this.libelleRc = c['libelleRc'] || '';
      this.toleranceCm = c['toleranceCm'] ?? this.toleranceCm;
      this.analyse = c['analyse'] || null;
      this.nouveaux = c['nouveaux'] || [];
      this.nbNouveaux = c['nbNouveaux'] ?? 0;
      this.rayonCouvertureKm = c['rayonCouvertureKm'] ?? this.rayonCouvertureKm;
      this.pointsCouvertureMin = c['pointsCouvertureMin'] ?? this.pointsCouvertureMin;
      this.densification = c['densification'] || null;
      this.densificationPerimee = !!c['densificationPerimee'];
      this.zones = c['zones'] || [];
      this.typeDessin = c['typeDessin'] || 'densification';
      this.afficherZones = c['afficherZones'] ?? true;
      this.paramZone = { ...this.paramZone, ...(c['paramZone'] || {}) };
      this.zoneEtudeId = c['zoneEtudeId'] ?? (this.zones[0]?.id || null);
      this.iterations = c['iterations'] || [];
      this.groupeHomogene = c['groupeHomogene'] || null;
      this.recalculAuto = c['recalculAuto'] ?? true;
      this.resultatZone = null;
      this.selection = new Set();
      this.zoneSelectionnee = null;
      const perso = c['perso'] || {};
      (['controle', 'densification'] as ContexteReseau[]).forEach(ctx => {
        this.perso[ctx] = Array.isArray(perso[ctx]) ? { lignes: perso[ctx], resultat: null, calcul: false, erreur: '' } : null;
      });
      if (c['mesFonds']) this.fusionnerFonds(c['mesFonds']);
      this.onglet = c['onglet'] && c['onglet'] !== 'fonds' ? c['onglet'] : 'points';
    } finally {
      this.chargementEtude = false;
    }
    (['controle', 'densification'] as ContexteReseau[]).forEach(ctx => { if (this.perso[ctx]) this.evaluerPerso(ctx, true); });
    this.vue$.next(this.construireVue());
    this.modifie = false;
    const ids = this.zones.map(z => z.id);
    if (ids.length && !this.anciens.length) this.cadrerZones$.next(ids);
  }

  /** Fonds de l'étude ajoutés à « Mes fonds » (fonds personnalisés compris), sans rien retirer. */
  private fusionnerFonds(m: MesFonds): void {
    let courant = this.mesFonds;
    (m.ids || []).forEach(id => { courant = ajouterDuCatalogue(courant, id); });
    const connus = new Set(courant.persos.map(f => f.url));
    const persos = [...courant.persos, ...(m.persos || []).filter(f => !connus.has(f.url))];
    courant = { ...courant, persos, actif: m.actif && [...courant.ids, ...persos.map(f => f.id)].includes(m.actif) ? m.actif : courant.actif };
    this.majFonds(courant);
  }

  private marquerModifie(): void {
    if (this.chargementEtude) return;
    this.modifie = true;
    if (this.etude && this.autosauvegarde) {
      clearTimeout(this.minuteurSauvegarde);
      this.minuteurSauvegarde = setTimeout(() => this.enregistrer(), DELAI_AUTOSAUVEGARDE_MS);
    }
  }

  basculerAutosauvegarde(actif: boolean): void {
    this.autosauvegarde = actif;
    localStorage.setItem(CLE_AUTOSAUVEGARDE, actif ? '1' : '0');
    if (actif && this.modifie && this.etude) this.enregistrer();
  }

  /** Enregistre l'étude ouverte (ou en crée une si `meta` est fourni). */
  enregistrer(meta?: { nom: string; dossier?: string; description?: string }): void {
    clearTimeout(this.minuteurSauvegarde);
    if (this.sauvegardeEnCours) return;
    const contenu = this.serialiser();
    const creation = !this.etude || !!meta;
    if (creation && !meta) return;
    this.sauvegardeEnCours = true;
    this.erreurSauvegarde = '';
    const requete = creation
      ? this.service.creerEtude({ nom: meta!.nom, dossier: meta!.dossier || '', description: meta!.description || '', contenu })
      : this.service.modifierEtude(this.etude!.id, { contenu });
    requete.subscribe({
      next: e => {
        this.etude = { ...(this.etude || {}), ...e } as EtudeReseau;
        this.sauvegardeEnCours = false;
        this.modifie = false;
        this.derniereSauvegarde = new Date();
        if (creation) this.toast.success('Étude', `« ${e.nom} » enregistrée.`);
      },
      error: err => {
        this.sauvegardeEnCours = false;
        this.erreurSauvegarde = message(err, 'Enregistrement impossible.');
        this.toast.error('Étude', this.erreurSauvegarde);
      },
    });
  }

  ouvrirEtude(id: string): void {
    this.service.etude(id).subscribe({
      next: e => {
        this.restaurer(e.contenu || {});
        this.etude = { ...e, contenu: undefined };
        this.derniereSauvegarde = new Date(e.updated_at);
        this.toast.success('Étude', `« ${e.nom} » ouverte.`);
      },
      error: err => this.toast.error('Étude', message(err, 'Ouverture impossible.')),
    });
  }

  /** Repart d'un espace vide (l'étude ouverte est fermée, rien n'est supprimé). */
  nouvelleEtude(): void {
    this.etude = null;
    this.restaurer({});
    this.controle = null;
    this.derniereSauvegarde = null;
  }

  /** L'étude ouverte a été supprimée, renommée ou rangée ailleurs. */
  majEtudeOuverte(e: EtudeReseau | null): void {
    if (!this.etude) return;
    if (!e) { this.etude = null; this.modifie = true; return; }
    if (e.id === this.etude.id) this.etude = { ...this.etude, ...e, contenu: undefined };
  }

  /** Fichier JSON autonome (sauvegarde locale, échange entre opérateurs). */
  exporterEtude(): string {
    return JSON.stringify({ format: 'sdgps-reseau-gnss', version: VERSION_CONTENU, nom: this.etude?.nom || 'Étude',
                            contenu: this.serialiser() });
  }

  importerEtude(texte: string): boolean {
    try {
      const d = JSON.parse(texte);
      if (d?.format !== 'sdgps-reseau-gnss' || typeof d.contenu !== 'object') throw new Error();
      this.etude = null;
      this.restaurer(d.contenu);
      this.modifie = true;
      this.toast.success('Étude', `« ${d.nom || 'Étude'} » chargée : enregistrez-la pour la conserver.`);
      return true;
    } catch {
      this.toast.error('Étude', 'Fichier non reconnu (export d’une étude du module Réseau GNSS attendu).');
      return false;
    }
  }

  // ================================================================== 5. fonds de carte

  /**
   * Liste mémoïsée : elle n'est recalculée que si « Mes fonds » ou le catalogue changent.
   * Indispensable — la carte reçoit `fondActif` en entrée ; un nouvel objet à chaque cycle de
   * détection relancerait le chargement du fond, dont les événements Leaflet relancent un
   * cycle… (boucle infinie qui fige la page).
   */
  private cacheFonds: { mes: MesFonds | null; catalogue: unknown; liste: FondCarte[] } =
    { mes: null, catalogue: null, liste: [] };

  get listeFonds(): FondCarte[] {
    const catalogue = this.referentiel?.fonds.catalogue || CATALOGUE_VIDE;
    if (this.cacheFonds.mes !== this.mesFonds || this.cacheFonds.catalogue !== catalogue) {
      this.cacheFonds = { mes: this.mesFonds, catalogue, liste: listeMesFonds(this.mesFonds, catalogue) };
    }
    return this.cacheFonds.liste;
  }

  get fondActif(): FondCarte | null {
    const liste = this.listeFonds;
    return liste.find(f => f.id === this.mesFonds.actif) || liste[0] || null;
  }

  private majFonds(m: MesFonds): void {
    this.mesFonds = m;
    enregistrerMesFonds(m);
  }

  choisirFond(id: string): void { this.majFonds({ ...this.mesFonds, actif: id }); }
  ajouterFondCatalogue(id: string): void { this.majFonds(ajouterDuCatalogue(this.mesFonds, id)); }
  retirerFond(id: string): void { this.majFonds(retirerFond(this.mesFonds, id)); }
  estDansMesFonds(id: string): boolean { return this.mesFonds.ids.includes(id); }

  ajouterFondPersonnel(f: Partial<FondCarte>): FondCarte {
    const fond = nouveauFondPersonnel(f);
    this.majFonds({ ...this.mesFonds, persos: [...this.mesFonds.persos, fond], actif: fond.id });
    return fond;
  }

  // ================================================================== carte

  private pointCarte(p: PointReseau, style: StylePoint, extra: Partial<PointCarte> = {}): PointCarte {
    const [lat, lon] = lambertVersWgs84(Number(p.x_m), Number(p.y_m), this.zone);
    return {
      nom_point: p.nom_point, x_m: Number(p.x_m), y_m: Number(p.y_m), lat, lon, style,
      reference: p.reference, nature_materialisation: p.nature_materialisation,
      nature_signalisation: p.nature_signalisation, ...extra,
    };
  }

  /** Recompose ce que la carte affiche pour l'onglet courant. */
  rafraichirVue(): void {
    this.nettoyerSelection();
    this.marquerModifie();
    if (this.onglet === 'fonds') return; // la carte garde la vue de l'onglet précédent
    this.vue$.next(this.construireVue());
  }

  /** Redessine sans compter une modification (résultat d'un calcul arrivé, sélection). */
  redessiner(): void {
    if (this.onglet !== 'fonds') this.vue$.next(this.construireVue());
  }

  construireVue(): VueCarte | null {
    const valides = this.anciens.filter(a => ReseauGpsStore.coordonneesValides(a));
    let vue: VueCarte | null;
    switch (this.onglet) {
      case 'controle': vue = this.vueControle(valides); break;
      case 'ecarts': vue = this.vueEcarts(); break;
      case 'densification': vue = this.vueDensification(); break;
      case 'zones': vue = this.resultatZone ? this.vueResultatZone() : (valides.length ? {
        points: valides.map(a => this.pointCarte(a, a.retenu ? 'ancien' : 'ecarte', { note: a.motifEcart })),
        lignes: [], triangles: [] } : null); break;
      default:
        vue = valides.length ? {
          points: valides.map(a => this.pointCarte(a, a.retenu ? 'ancien' : 'ecarte', { note: a.motifEcart })),
          lignes: [], triangles: [],
        } : null;
    }
    const zones = this.zonesCarte();
    if (!vue && !zones.length) return null;
    vue = vue || { points: [], lignes: [], triangles: [] };
    return {
      ...vue, zones, selection: this.selectionLigne || undefined,
      selectionnes: [...this.selection].filter(k => k.startsWith('p:')).map(k => k.slice(2)),
      lignesSelectionnees: [...this.selection].filter(k => k.startsWith('l:')).map(k => k.slice(2)),
    };
  }

  private zonesCarte(): ZoneCarte[] {
    if (!this.afficherZones) return [];
    return this.zones.map(z => ({
      id: z.id, nom: z.nom, type: z.type, couleur: z.couleur, polygones: z.polygones, active: z.active,
      selectionnee: z.id === this.zoneSelectionnee,
    }));
  }

  /** Lignes d'un réseau personnalisé : celles du résultat s'il est à jour, sinon provisoires. */
  private lignesPerso(ctx: ContexteReseau, points: PointCarte[]): LigneCarte[] {
    const p = this.perso[ctx];
    if (!p) return [];
    const index = new Map(points.map((pt, i) => [pt.nom_point, i]));
    const r = p.resultat;
    const resultatLignes: LigneBase[] | undefined = r ? ('reseau' in r ? r.reseau.lignes : r.lignes) : undefined;
    const nomsResultat = r ? r.points.map(x => x.nom_point) : [];
    const flags = new Map((resultatLignes || []).map(l =>
      [ReseauGpsStore.cleLigne(nomsResultat[l.de], nomsResultat[l.a]), l]));
    const maxM = Number(this.longueurMaxKm) * 1000;
    return p.lignes.flatMap(([a, b]) => {
      const i = index.get(a), j = index.get(b);
      if (i === undefined || j === undefined) return [];
      const d = Math.hypot(points[i].x_m - points[j].x_m, points[i].y_m - points[j].y_m);
      const f = p.calcul ? undefined : flags.get(ReseauGpsStore.cleLigne(a, b));
      const az = (Math.atan2(points[j].x_m - points[i].x_m, points[j].y_m - points[i].y_m) * 180 / Math.PI + 360) % 360;
      return [{ de: i, a: j, distance_m: d, distance_km: d / 1000, azimut_deg: f?.azimut_deg ?? az,
                en_boucle: f ? f.en_boucle : true, trop_longue: d > maxM, perso: true }];
    });
  }

  private trianglesPerso(ctx: ContexteReseau, points: PointCarte[]) {
    const p = this.perso[ctx];
    const r = p?.resultat;
    if (!r || p?.calcul) return [];
    const tri = 'reseau' in r ? r.reseau.triangles : r.triangles;
    const noms = r.points.map(x => x.nom_point);
    const index = new Map(points.map((pt, i) => [pt.nom_point, i]));
    return tri.map(t => ({ ...t, sommets: t.sommets.map(s => index.get(noms[s]) ?? -1) }))
      .filter(t => t.sommets.every(s => s >= 0));
  }

  private vueControle(valides: PointAncien[]): VueCarte | null {
    const r = this.controle;
    const ecartes = valides.filter(a => !a.retenu).map(a => this.pointCarte(a, 'ecarte', { note: a.motifEcart }));
    if (this.perso.controle && (this.varianteActive === 'personnalise' || !r || this.controlePerime)) {
      const pts = valides.filter(a => a.retenu).map(a => this.pointCarte(a, 'ancien'));
      return { points: [...pts, ...ecartes], lignes: this.lignesPerso('controle', pts),
               triangles: this.trianglesPerso('controle', pts) };
    }
    if (!r || this.controlePerime) {
      const pts = valides.filter(a => a.retenu).map(a => this.pointCarte(a, 'ancien'));
      return pts.length || ecartes.length ? { points: [...pts, ...ecartes], lignes: [], triangles: [] } : null;
    }
    const aEcarter = new Map((r.suppressions || []).map(s => [s.nom_point, s.motif]));
    if (this.varianteActive === 'personnalise' && this.perso.controle) {
      const pts = valides.filter(a => a.retenu).map(a => this.pointCarte(a, 'ancien'));
      return { points: [...pts, ...ecartes], lignes: this.lignesPerso('controle', pts),
               triangles: this.trianglesPerso('controle', pts) };
    }
    if (this.varianteActive === 'parfaite') {
      const p = r.parfaite;
      return {
        points: [...p.points.map(pt => ({
          ...pt, x_m: Number(pt.x_m), y_m: Number(pt.y_m),
          style: (pt.statut === 'suggere' ? 'suggere' : 'ancien') as StylePoint,
        })), ...ecartes],
        lignes: p.lignes, triangles: p.triangles, suggestions: p.suggestions,
      };
    }
    const v = r.variantes.find(x => x.code === this.varianteActive) || r.variantes[0];
    const observees = this.lignesObservees();
    const nomsR = r.points.map(p => p.nom_point);
    return {
      lignesAObserver: observees.size
        ? v.lignes.filter(l => !observees.has(ReseauGpsStore.cleLigne(nomsR[l.de], nomsR[l.a]))).map(l => [nomsR[l.de], nomsR[l.a]].sort().join('\u0000'))
        : undefined,
      points: [...r.points.map((pt, i) => ({
        ...pt, x_m: Number(pt.x_m), y_m: Number(pt.y_m), style: 'ancien' as StylePoint, degre: v.degres[i] ?? pt.degre,
        marque: aEcarter.has(pt.nom_point), note: aEcarter.get(pt.nom_point),
      })), ...ecartes],
      lignes: v.lignes, triangles: v.triangles,
    };
  }

  private vueEcarts(): VueCarte | null {
    const pts = this.anciensRetenus;
    if (!pts.length) return null;
    const points = pts.map(a => this.pointCarte(a,
      a.homogene === true ? 'homogene' : a.homogene === false ? 'non_homogene' : 'non_controle'));
    const index = new Map(pts.map((a, i) => [a.nom_point, i]));
    const vues = new Set<string>();
    const lignes = (this.analyse?.lignes || []).filter(l => l.hors_tolerance).flatMap(l => {
      const i = index.get(l.nom_point_fixe), j = index.get(l.nom_point_calcule);
      const cle = [l.nom_point_fixe, l.nom_point_calcule].sort().join('|');
      if (i === undefined || j === undefined || vues.has(cle)) return [];
      vues.add(cle);
      const d = Math.hypot(points[i].x_m - points[j].x_m, points[i].y_m - points[j].y_m);
      return [{ de: i, a: j, distance_m: d, distance_km: d / 1000, azimut_deg: 0, en_boucle: true,
                trop_longue: false, style: 'incompatible' as const, ecart_m: Number(l.delta_d_m) }];
    });
    return { points, lignes, triangles: [] };
  }

  /** Cercles des rayons de déplacement (centrés sur l'emplacement proposé) et points déplaçables. */
  private complementDensification(): Partial<VueCarte> {
    const cercles = this.nouveaux.filter(n => n.ancre && n.rayon_m !== undefined).map(n => {
      const [lat, lon] = lambertVersWgs84(n.ancre!.x_m, n.ancre!.y_m, this.zone);
      return { nom: n.nom_point, lat, lon, rayon_m: Math.max(n.rayon_m!, 10), depasse: this.horsRayon(n) };
    });
    return { cercles, deplacables: this.nouveaux.map(n => n.nom_point) };
  }

  private vueDensification(): VueCarte | null {
    const v = this.vueDensificationBase();
    return v ? { ...v, ...this.complementDensification() } : null;
  }

  private vueDensificationBase(): VueCarte | null {
    const r = this.densification;
    if (this.perso.densification) {
      const pts = this.pointsContexte('densification').map(p => this.pointCarte(p,
        p.statut === 'nouveau' ? ((p as PointNouveau).origine === 'propose' ? 'propose' : 'nouveau') : 'homogene'));
      const res = this.perso.densification.resultat as ResultatDensification | null;
      return { points: pts, lignes: this.lignesPerso('densification', pts),
               triangles: this.trianglesPerso('densification', pts),
               nonCouverts: res && !this.perso.densification.calcul ? res.couverture.non_couverts : undefined };
    }
    if (r && !this.densificationPerimee) {
      return {
        points: r.points.map(p => ({
          ...p, x_m: Number(p.x_m), y_m: Number(p.y_m),
          style: (p.statut !== 'nouveau' ? 'homogene' : p.origine === 'propose' ? 'propose' : 'nouveau') as StylePoint,
        })),
        lignes: r.reseau.lignes, triangles: r.reseau.triangles,
        zone: r.zone_polygone, nonCouverts: r.couverture.non_couverts,
      };
    }
    const points = [
      ...this.anciensDensification.map(a => this.pointCarte(a, 'homogene')),
      ...this.nouveaux.filter(n => ReseauGpsStore.coordonneesValides(n))
        .map(n => this.pointCarte(n, n.origine === 'propose' ? 'propose' : 'nouveau')),
    ];
    return points.length ? { points, lignes: [], triangles: [] } : null;
  }
}
