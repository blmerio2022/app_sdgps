import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  AnalyseEcarts, FondCatalogue, LigneRc, PointReseau, ReferentielReseau, ReseauGpsService, ResultatDensification,
  ResultatReseau, SuggestionSuppression,
} from '../../core/services/reseau-gps.service';
import { ToastService } from '../../core/services/toast.service';
import {
  FondCarte, MesFonds, ajouterDuCatalogue, chargerMesFonds, enregistrerMesFonds, listeMesFonds,
  nouveauFondPersonnel, retirerFond,
} from './fonds-carte';
import { lambertVersWgs84, wgs84VersLambert } from './lambert-maroc';
import { PointCarte, StylePoint, VueCarte } from './reseau-carte/reseau-carte.component';

/**
 * Onglets, dans l'ordre du travail de densification :
 * 1. points anciens disponibles dans la zone ; 2. réseau de contrôle de stabilité
 * (optimisation : points à rechercher / à écarter) ; 3. contrôle des écarts (RC) et points
 * homogènes ; 4. densification (points nouveaux) ; 5. fonds de carte.
 */
export type OngletReseau = 'points' | 'controle' | 'ecarts' | 'densification' | 'fonds';

export interface PointAncien extends PointReseau {
  /** Retenu dans le réseau (l'opérateur peut écarter un point, avec un motif). */
  retenu: boolean;
  motifEcart?: string;
  /** Homogène d'après le contrôle des écarts ; null = pas (encore) contrôlé. */
  homogene: boolean | null;
}

export interface PointNouveau extends PointReseau { origine: 'manuel' | 'propose'; }

const CATALOGUE_VIDE: FondCatalogue[] = [];

const message = (err: any, defaut: string) => {
  const d = err?.error;
  return d?.detail || (d && typeof d === 'object' ? JSON.stringify(d) : defaut);
};

/** État du module « Réseau GPS », partagé par les onglets et la carte (fourni par la page). */
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
      error: () => this.toast.error('Réseau GPS', 'Chargement du référentiel impossible.'),
    });
  }

  choisirOnglet(o: OngletReseau): void {
    this.onglet = o;
    if (o !== 'densification') this.modeAjoutCarte = false;
    this.rafraichirVue();
  }

  // ================================================================== 1. points anciens

  definirAnciens(points: PointReseau[], libelle: string): void {
    this.anciens = points.map(p => ({ ...p, statut: 'ancien', retenu: true, homogene: null }));
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

  /** Une saisie a changé : les résultats calculés ne correspondent plus aux données. */
  toutInvalider(): void {
    if (this.controle) this.controlePerime = true;
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
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
    this.toast.success('Réseau GPS', `${s.nom_point} écarté : recalculez le réseau.`);
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
    });
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  basculerHomogene(a: PointAncien): void {
    a.homogene = !a.homogene;
    if (this.densification) this.densificationPerimee = true;
    this.rafraichirVue();
  }

  get nbHomogenes(): number { return this.anciensRetenus.filter(a => a.homogene === true).length; }

  // ================================================================== 4. densification

  /** Points d'appui de la densification : anciens retenus ET homogènes. Sans contrôle des
   *  écarts, tous les anciens retenus (signalé à l'écran). */
  get anciensDensification(): PointAncien[] {
    const retenus = this.anciensRetenus;
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

  private lancerDensification(proposer: boolean): void {
    if (this.blocageDensification || this.calculDensification) return;
    this.calculDensification = true;
    this.erreurDensification = '';
    this.service.densifier({
      anciens: this.anciensDensification.map(p => this.versApi(p)),
      nouveaux: this.nouveaux.filter(n => ReseauGpsStore.coordonneesValides(n))
        .map(n => this.versApi({ ...n, statut: 'nouveau' })),
      nb_nouveaux: Number(this.nbNouveaux) || 0, proposer, zone: this.zone,
      longueur_max_km: Number(this.longueurMaxKm), rayon_couverture_km: Number(this.rayonCouvertureKm),
      points_couverture_min: Number(this.pointsCouvertureMin),
    }).subscribe({
      next: r => {
        this.densification = r;
        this.densificationPerimee = false;
        this.calculDensification = false;
        this.nouveaux = r.points.filter(p => p.statut === 'nouveau').map(p => ({
          ...p, statut: 'nouveau', origine: p.origine === 'propose' ? 'propose' : 'manuel',
          x_m: Math.round(Number(p.x_m) * 100) / 100, y_m: Math.round(Number(p.y_m) * 100) / 100,
        }));
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
    this.rafraichirVue();
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
    if (this.onglet === 'fonds') return; // la carte garde la vue de l'onglet précédent
    this.vue$.next(this.construireVue());
  }

  construireVue(): VueCarte | null {
    const valides = this.anciens.filter(a => ReseauGpsStore.coordonneesValides(a));
    switch (this.onglet) {
      case 'controle': return this.vueControle(valides);
      case 'ecarts': return this.vueEcarts();
      case 'densification': return this.vueDensification();
      default:
        return valides.length ? {
          points: valides.map(a => this.pointCarte(a, a.retenu ? 'ancien' : 'ecarte', { note: a.motifEcart })),
          lignes: [], triangles: [],
        } : null;
    }
  }

  private vueControle(valides: PointAncien[]): VueCarte | null {
    const r = this.controle;
    const ecartes = valides.filter(a => !a.retenu).map(a => this.pointCarte(a, 'ecarte', { note: a.motifEcart }));
    if (!r || this.controlePerime) {
      const pts = valides.filter(a => a.retenu).map(a => this.pointCarte(a, 'ancien'));
      return pts.length || ecartes.length ? { points: [...pts, ...ecartes], lignes: [], triangles: [] } : null;
    }
    const aEcarter = new Map((r.suppressions || []).map(s => [s.nom_point, s.motif]));
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
    return {
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

  private vueDensification(): VueCarte | null {
    const r = this.densification;
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
