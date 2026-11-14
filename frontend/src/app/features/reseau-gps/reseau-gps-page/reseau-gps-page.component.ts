import { Component, OnInit } from '@angular/core';
import {
  PointReseau, ReferentielReseau, ReseauGpsService, ResultatReseau, SourceLpa, TypeReseau,
  VarianteReseau,
} from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  CLE_FOND_ACTIF, FONDS_INTEGRES, FondCarte, TypeFond, chargerFondsPersonnels,
  enregistrerFondsPersonnels, nouveauFondPersonnel, validerFond,
} from '../fonds-carte';
import { lireFichierPoints } from '../points-import.util';
import { VueCarte } from '../reseau-carte/reseau-carte.component';

export type SourcePoints = 'saisie' | 'import' | 'lpa';

/** Ligne du tableau comparatif des variantes. */
interface LigneComparaison {
  libelle: string;
  norme: string;
  valeur: (v: VarianteReseau) => string;
  /** Meilleure valeur = la plus grande (true) ou la plus petite (false) ; null = pas de comparaison. */
  plusGrandMieux: boolean | null;
  brut: (v: VarianteReseau) => number;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const fr = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? '—' : x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Module « Réseau de triangulation GPS » : saisie / import / reprise d'une LPA, choix du type
 * de réseau, calcul des variantes (backend `reseaux/`), recommandation justifiée, variante
 * parfaite avec emplacements à rechercher, carte multi-fonds.
 *
 * Rien n'est enregistré côté serveur (module sans état) ; seuls les fonds de carte
 * personnels et le fond actif sont mémorisés dans le navigateur.
 */
@Component({
  selector: 'app-reseau-gps-page',
  templateUrl: './reseau-gps-page.component.html',
  styleUrls: ['./reseau-gps-page.component.scss'],
})
export class ReseauGpsPageComponent implements OnInit {
  referentiel: ReferentielReseau | null = null;
  source: SourcePoints = 'saisie';
  points: PointReseau[] = [];
  sourcesLpa: SourceLpa[] = [];
  sourcesChargees = false;
  ssdgpsChoisi = '';
  libelleLpa = '';

  typeReseau: TypeReseau = 'anciens';
  zone = 'nord';
  longueurMaxKm = 10;
  nbSuggestionsMax = 5;

  resultat: ResultatReseau | null = null;
  resultatPerime = false;
  varianteActive = '';
  vue: VueCarte | null = null;
  calcul = false;
  erreur = '';
  importEnCours = false;
  normesOuvertes = false;

  fonds: FondCarte[] = [];
  fondActifId = 'osm';
  etiquettesDistances = true;
  afficherTriangles = true;
  formFondOuvert = false;
  nouveauFond: { nom: string; type: TypeFond; url: string; couches: string; attribution: string } = this.fondVide();
  erreurFond = '';

  readonly comparaison: LigneComparaison[] = [
    { libelle: 'Score de conformité', norme: '', plusGrandMieux: true,
      brut: v => v.indicateurs.score, valeur: v => `${fr(v.indicateurs.score)}/100` },
    { libelle: 'Angle minimal', norme: 'N1', plusGrandMieux: true,
      brut: v => v.indicateurs.angle_min, valeur: v => `${fr(v.indicateurs.angle_min)}°` },
    { libelle: 'Angle maximal', norme: 'N1', plusGrandMieux: false,
      brut: v => v.indicateurs.angle_max, valeur: v => `${fr(v.indicateurs.angle_max)}°` },
    { libelle: 'Triangles conformes', norme: 'N1', plusGrandMieux: true,
      brut: v => v.indicateurs.taux_triangles_conformes, valeur: v => pct(v.indicateurs.taux_triangles_conformes) },
    { libelle: "Écart moyen à l'équilatéral", norme: 'N2', plusGrandMieux: false,
      brut: v => v.indicateurs.ecart_equilateral_moyen ?? 999, valeur: v => `${fr(v.indicateurs.ecart_equilateral_moyen)}°` },
    { libelle: 'Lignes de base', norme: '', plusGrandMieux: null,
      brut: v => v.indicateurs.nb_lignes_base, valeur: v => String(v.indicateurs.nb_lignes_base) },
    { libelle: 'Triangles', norme: '', plusGrandMieux: null,
      brut: v => v.indicateurs.nb_triangles, valeur: v => String(v.indicateurs.nb_triangles) },
    { libelle: 'Redondance (boucles indépendantes)', norme: 'N4', plusGrandMieux: true,
      brut: v => v.indicateurs.redondance, valeur: v => String(v.indicateurs.redondance) },
    { libelle: 'Lignes en boucle', norme: 'N4', plusGrandMieux: true,
      brut: v => v.indicateurs.taux_lignes_en_boucle, valeur: v => pct(v.indicateurs.taux_lignes_en_boucle) },
    { libelle: 'Liaisons min. par point', norme: 'N5', plusGrandMieux: true,
      brut: v => v.indicateurs.degre_min, valeur: v => String(v.indicateurs.degre_min) },
    { libelle: 'Points à ≥ 3 liaisons', norme: 'N5', plusGrandMieux: true,
      brut: v => v.indicateurs.taux_points_bien_lies, valeur: v => pct(v.indicateurs.taux_points_bien_lies) },
    { libelle: 'Ligne la plus longue', norme: 'N7', plusGrandMieux: false,
      brut: v => v.indicateurs.longueur_max_km, valeur: v => `${fr(v.indicateurs.longueur_max_km, 3)} km` },
    { libelle: 'Longueur totale observée', norme: '', plusGrandMieux: false,
      brut: v => v.indicateurs.longueur_totale_km, valeur: v => `${fr(v.indicateurs.longueur_totale_km, 2)} km` },
    { libelle: 'Lignes par point (coût)', norme: '', plusGrandMieux: false,
      brut: v => v.indicateurs.lignes_par_point, valeur: v => fr(v.indicateurs.lignes_par_point, 2) },
    { libelle: 'Stations voisines non reliées', norme: 'N8', plusGrandMieux: false,
      brut: v => v.indicateurs.nb_violations_stations_voisines, valeur: v => String(v.indicateurs.nb_violations_stations_voisines) },
  ];

  constructor(private service: ReseauGpsService, private toast: ToastService) {}

  ngOnInit(): void {
    this.fonds = [...FONDS_INTEGRES, ...chargerFondsPersonnels()];
    const memorise = localStorage.getItem(CLE_FOND_ACTIF);
    if (memorise && this.fonds.some(f => f.id === memorise)) this.fondActifId = memorise;
    this.service.referentiel().subscribe({
      next: r => {
        this.referentiel = r;
        this.zone = r.zone_defaut;
        this.longueurMaxKm = r.defauts.longueur_max_km;
        this.nbSuggestionsMax = r.defauts.nb_suggestions_max;
      },
      error: () => { this.erreur = 'Chargement du référentiel impossible.'; },
    });
  }

  // ------------------------------------------------------------------ points

  choisirSource(s: SourcePoints): void {
    this.source = s;
    if (s === 'lpa' && !this.sourcesChargees) {
      this.service.sourcesLpa().subscribe({
        next: l => { this.sourcesLpa = l; this.sourcesChargees = true; },
        error: () => this.toast.error('Réseau GPS', 'Liste des LPA indisponible.'),
      });
    }
  }

  ajouterPoint(): void {
    this.points = [...this.points, {
      nom_point: `P${this.points.length + 1}`, x_m: null, y_m: null, reference: '',
      nature_materialisation: '', nature_signalisation: '', statut: 'ancien',
    }];
    this.marquerPerime();
  }

  supprimerPoint(i: number): void {
    this.points = this.points.filter((_, k) => k !== i);
    this.marquerPerime();
  }

  viderPoints(): void {
    this.points = [];
    this.libelleLpa = '';
    this.resultat = null;
    this.vue = null;
  }

  marquerPerime(): void {
    if (this.resultat) this.resultatPerime = true;
  }

  async importerFichier(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier) return;
    this.importEnCours = true;
    try {
      const lus = await lireFichierPoints(fichier);
      if (!lus.length) {
        this.toast.error('Réseau GPS', 'Aucun point exploitable dans ce fichier (colonnes X(m) et Y(m) attendues).');
      } else {
        this.points = lus;
        this.libelleLpa = fichier.name;
        if (lus.some(p => p.statut === 'nouveau')) this.typeReseau = 'mixte';
        this.marquerPerime();
        this.toast.success('Réseau GPS', `${lus.length} point(s) importé(s).`);
      }
    } catch {
      this.toast.error('Réseau GPS', 'Lecture du fichier impossible.');
    } finally {
      this.importEnCours = false;
      input.value = '';
    }
  }

  chargerLpa(): void {
    if (!this.ssdgpsChoisi) return;
    this.service.sourceLpa(this.ssdgpsChoisi).subscribe({
      next: d => {
        this.points = d.points.map(p => ({ ...p, statut: 'ancien' }));
        this.libelleLpa = d.libelle;
        if (d.zone_proposee) this.zone = d.zone_proposee;
        this.marquerPerime();
        this.toast.success('Réseau GPS', `${d.points.length} point(s) repris de la LPA.`);
      },
      error: () => this.toast.error('Réseau GPS', 'Reprise de la LPA impossible.'),
    });
  }

  get nbAnciens(): number { return this.points.filter(p => p.statut !== 'nouveau').length; }
  get nbNouveaux(): number { return this.points.filter(p => p.statut === 'nouveau').length; }

  pointsValides(): PointReseau[] {
    return this.points.filter(p => p.x_m !== null && p.y_m !== null && isFinite(Number(p.x_m)) && isFinite(Number(p.y_m)));
  }

  /** Raison empêchant le calcul, ou null. */
  get blocage(): string | null {
    const valides = this.pointsValides();
    const retenus = this.typeReseau === 'anciens' ? valides.filter(p => p.statut !== 'nouveau') : valides;
    if (retenus.length < 3) return 'Saisissez au moins 3 points avec leurs coordonnées X et Y.';
    if (this.typeReseau === 'mixte' && !retenus.some(p => p.statut === 'nouveau')) {
      return 'Un réseau mixte demande au moins un point nouveau.';
    }
    return null;
  }

  // ------------------------------------------------------------------ calcul

  generer(): void {
    if (this.blocage || this.calcul) return;
    this.calcul = true;
    this.erreur = '';
    this.service.generer({
      points: this.pointsValides().map(p => ({
        ...p, x_m: Number(p.x_m), y_m: Number(p.y_m), statut: p.statut === 'nouveau' ? 'nouveau' : 'ancien',
      })),
      type_reseau: this.typeReseau,
      zone: this.zone,
      longueur_max_km: Number(this.longueurMaxKm),
      nb_suggestions_max: Number(this.nbSuggestionsMax),
    }).subscribe({
      next: r => {
        this.resultat = r;
        this.resultatPerime = false;
        this.calcul = false;
        this.choisirVariante(r.recommandee || r.variantes[0]?.code || 'parfaite');
      },
      error: err => {
        this.calcul = false;
        const d = err?.error;
        this.erreur = d?.detail || (d && typeof d === 'object' ? JSON.stringify(d) : 'Calcul du réseau impossible.');
      },
    });
  }

  get toutesVariantes(): VarianteReseau[] {
    return this.resultat ? [...this.resultat.variantes, this.resultat.parfaite] : [];
  }

  get variante(): VarianteReseau | null {
    return this.toutesVariantes.find(v => v.code === this.varianteActive) || null;
  }

  choisirVariante(code: string): void {
    this.varianteActive = code;
    const r = this.resultat;
    if (!r) { this.vue = null; return; }
    if (code === 'parfaite') {
      this.vue = { points: r.parfaite.points, lignes: r.parfaite.lignes, triangles: r.parfaite.triangles,
                   suggestions: r.parfaite.suggestions };
      return;
    }
    const v = r.variantes.find(x => x.code === code);
    if (!v) return;
    const points = r.points.map((p, i) => ({ ...p, degre: v.degres[i] ?? p.degre }));
    this.vue = { points, lignes: v.lignes, triangles: v.triangles };
  }

  /** La valeur de cette variante est-elle la meilleure de la ligne ? */
  estMeilleure(ligne: LigneComparaison, v: VarianteReseau): boolean {
    if (ligne.plusGrandMieux === null) return false;
    const valeurs = this.toutesVariantes.map(ligne.brut);
    const cible = ligne.plusGrandMieux ? Math.max(...valeurs) : Math.min(...valeurs);
    return ligne.brut(v) === cible;
  }

  controlesEnEchec(v: VarianteReseau) { return v.controles.filter(c => !c.ok); }

  // ------------------------------------------------------------------ fonds de carte

  get fondActif(): FondCarte | null {
    return this.fonds.find(f => f.id === this.fondActifId) || this.fonds[0] || null;
  }

  choisirFond(id: string): void {
    this.fondActifId = id;
    localStorage.setItem(CLE_FOND_ACTIF, id);
  }

  ajouterFond(): void {
    const erreur = validerFond(this.nouveauFond);
    if (erreur) { this.erreurFond = erreur; return; }
    const fond = nouveauFondPersonnel(this.nouveauFond);
    this.fonds = [...this.fonds, fond];
    enregistrerFondsPersonnels(this.fonds);
    this.choisirFond(fond.id);
    this.nouveauFond = this.fondVide();
    this.erreurFond = '';
    this.formFondOuvert = false;
  }

  supprimerFond(id: string): void {
    this.fonds = this.fonds.filter(f => f.id !== id || !f.personnel);
    enregistrerFondsPersonnels(this.fonds);
    if (this.fondActifId === id) this.choisirFond('osm');
  }

  get fondsPersonnels(): FondCarte[] { return this.fonds.filter(f => f.personnel); }
  get fondsIntegres(): FondCarte[] { return this.fonds.filter(f => !f.personnel); }

  /** Nombre au format français (le locale fr n'est pas enregistré pour les pipes Angular). */
  fr(x: number | null | undefined, d = 1): string { return fr(x, d); }

  private fondVide() {
    return { nom: '', type: 'xyz' as TypeFond, url: '', couches: '', attribution: '' };
  }

  trackIndex(i: number): number { return i; }
}
