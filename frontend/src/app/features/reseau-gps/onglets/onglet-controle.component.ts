import { Component } from '@angular/core';
import { VarianteReseau } from '../../../core/services/reseau-gps.service';
import {
  IterationControle, LIBELLES_QUALITE, PointAncien, QUALITES_A_ECARTER, QualitePoint, ReseauGpsStore,
} from '../reseau-gps.store';

/** Ligne du tableau comparatif des variantes. */
export interface LigneComparaison {
  libelle: string;
  norme: string;
  valeur: (v: VarianteReseau) => string;
  /** Meilleure valeur = la plus grande (true) ou la plus petite (false) ; null = pas de comparaison. */
  plusGrandMieux: boolean | null;
  brut: (v: VarianteReseau) => number;
}

export const fr = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? '—' : x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number) => `${Math.round(x * 100)} %`;

export const COMPARAISON: LigneComparaison[] = [
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
  { libelle: 'Redondance (boucles indépendantes)', norme: 'N4', plusGrandMieux: true,
    brut: v => v.indicateurs.redondance, valeur: v => String(v.indicateurs.redondance) },
  { libelle: 'Lignes en boucle', norme: 'N4', plusGrandMieux: true,
    brut: v => v.indicateurs.taux_lignes_en_boucle, valeur: v => pct(v.indicateurs.taux_lignes_en_boucle) },
  { libelle: 'Points à ≥ 3 liaisons', norme: 'N5', plusGrandMieux: true,
    brut: v => v.indicateurs.taux_points_bien_lies, valeur: v => pct(v.indicateurs.taux_points_bien_lies) },
  { libelle: 'Ligne la plus longue', norme: 'N7', plusGrandMieux: false,
    brut: v => v.indicateurs.longueur_max_km, valeur: v => `${fr(v.indicateurs.longueur_max_km, 3)} km` },
  { libelle: 'Lignes par point (coût)', norme: '', plusGrandMieux: false,
    brut: v => v.indicateurs.lignes_par_point, valeur: v => fr(v.indicateurs.lignes_par_point, 2) },
  { libelle: 'Stations voisines non reliées', norme: 'N8', plusGrandMieux: false,
    brut: v => v.indicateurs.nb_violations_stations_voisines, valeur: v => String(v.indicateurs.nb_violations_stations_voisines) },
];

/**
 * Onglet 3 — réseau de contrôle de stabilité et d'homogénéité des points anciens : génération
 * pour la zone d'étude (ou la sélection), variantes, personnalisation, itérations arrêtées et
 * observées, qualification des points et validation du groupe homogène.
 */
@Component({
  selector: 'app-onglet-controle',
  templateUrl: './onglet-controle.component.html',
  styleUrls: ['./onglet.scss', './onglet-controle.component.scss'],
})
export class OngletControleComponent {
  readonly comparaison = COMPARAISON;
  readonly fr = fr;
  readonly qualites: QualitePoint[] = ['a_controler', 'homogene', 'non_homogene', 'instable', 'non_retrouve'];
  readonly libelles = LIBELLES_QUALITE;
  noteIteration = '';

  constructor(public store: ReseauGpsStore) {}

  get toutesVariantes(): VarianteReseau[] {
    const r = this.store.controle;
    return r ? [...r.variantes, r.parfaite] : [];
  }

  get variante(): VarianteReseau | null {
    return this.toutesVariantes.find(v => v.code === this.store.varianteActive) || null;
  }

  estMeilleure(ligne: LigneComparaison, v: VarianteReseau): boolean {
    if (ligne.plusGrandMieux === null) return false;
    const valeurs = this.toutesVariantes.map(ligne.brut);
    const cible = ligne.plusGrandMieux ? Math.max(...valeurs) : Math.min(...valeurs);
    return ligne.brut(v) === cible;
  }

  get comptes(): Record<QualitePoint, number> { return this.store.compteQualites(); }

  get aEcarter(): number {
    return this.store.anciensRetenus.filter(a => QUALITES_A_ECARTER.includes(this.store.qualiteDe(a))).length;
  }

  classeQualite(q: QualitePoint): string {
    return q === 'homogene' ? 'ok' : q === 'a_controler' ? 'neutre' : q === 'instable' ? 'warn' : 'ko';
  }

  arreter(): void {
    if (this.store.arreterReseau(this.noteIteration.trim())) this.noteIteration = '';
  }

  supprimer(it: IterationControle): void {
    if (window.confirm(`Supprimer l'itération n°${it.numero} ?`)) this.store.supprimerIteration(it);
  }

  desactiverNonConformes(): void {
    const n = this.store.desactiverNonConformes();
    if (n) this.store.rafraichirVue();
  }

  exporter(it: IterationControle, quoi: 'points' | 'lignes'): void {
    const blob = new Blob([this.store.csvIteration(it, quoi)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reseau-controle-iteration-${it.numero}-${quoi}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  trackNom(_: number, a: PointAncien): string { return a.nom_point; }

  get scoreRecommande(): number | null {
    const r = this.store.controle;
    return r?.variantes.find(v => v.code === r.recommandee)?.indicateurs.score ?? null;
  }
}
