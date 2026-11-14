import { Component } from '@angular/core';
import { VarianteReseau } from '../../../core/services/reseau-gps.service';
import { ReseauGpsStore } from '../reseau-gps.store';

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

/** Onglet 2 — réseau de contrôle de stabilité des points anciens et son optimisation. */
@Component({
  selector: 'app-onglet-controle',
  templateUrl: './onglet-controle.component.html',
  styleUrls: ['./onglet.scss', './onglet-controle.component.scss'],
})
export class OngletControleComponent {
  readonly comparaison = COMPARAISON;
  readonly fr = fr;

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

  get scoreRecommande(): number | null {
    const r = this.store.controle;
    return r?.variantes.find(v => v.code === r.recommandee)?.indicateurs.score ?? null;
  }
}
