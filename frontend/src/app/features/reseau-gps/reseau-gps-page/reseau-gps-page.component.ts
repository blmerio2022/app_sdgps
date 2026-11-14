import { Component, OnInit } from '@angular/core';
import { OngletReseau, ReseauGpsStore } from '../reseau-gps.store';
import { COULEURS_POINTS, LIBELLES_POINTS, StylePoint } from '../reseau-carte/reseau-carte.component';

interface DefOnglet { code: OngletReseau; titre: string; icone: string; etape: number | null; }

/** Légende de la carte selon l'onglet (seuls les éléments qu'il affiche). */
const LEGENDE: Record<OngletReseau, StylePoint[]> = {
  points: ['ancien', 'ecarte'],
  controle: ['ancien', 'ecarte', 'suggere'],
  ecarts: ['homogene', 'non_homogene', 'non_controle'],
  densification: ['homogene', 'propose', 'nouveau'],
  fonds: [],
};

/**
 * Module « Réseau de triangulation GPS ». Les onglets suivent le travail de densification
 * (points anciens → réseau de contrôle → contrôle des écarts → densification), plus les
 * fonds de carte ; la carte reste visible à droite et montre ce que l'onglet traite.
 * L'état est porté par `ReseauGpsStore`, fourni ici (une instance par visite de la page).
 */
@Component({
  selector: 'app-reseau-gps-page',
  templateUrl: './reseau-gps-page.component.html',
  styleUrls: ['./reseau-gps-page.component.scss'],
  providers: [ReseauGpsStore],
})
export class ReseauGpsPageComponent implements OnInit {
  readonly onglets: DefOnglet[] = [
    { code: 'points', titre: 'Points anciens', icone: 'fas fa-map-marker-alt', etape: 1 },
    { code: 'controle', titre: 'Réseau de contrôle', icone: 'fas fa-project-diagram', etape: 2 },
    { code: 'ecarts', titre: 'Contrôle des écarts', icone: 'fas fa-ruler-combined', etape: 3 },
    { code: 'densification', titre: 'Densification', icone: 'fas fa-map-pin', etape: 4 },
    { code: 'fonds', titre: 'Fonds de carte', icone: 'fas fa-layer-group', etape: null },
  ];
  readonly couleurs = COULEURS_POINTS;
  readonly libelles = LIBELLES_POINTS;
  etiquettesDistances = true;
  afficherTriangles = true;

  constructor(public store: ReseauGpsStore) {}

  ngOnInit(): void { this.store.init(); }

  /** Résumé affiché sous le titre de chaque onglet (état d'avancement). */
  resume(o: OngletReseau): string {
    const s = this.store;
    const score = (x: number) => x.toFixed(1).replace('.', ',');
    switch (o) {
      case 'points': return s.anciens.length ? `${s.anciensRetenus.length} retenu(s)` : 'À importer';
      case 'controle': {
        const r = s.controle;
        const v = r?.variantes.find(x => x.code === r.recommandee);
        return v ? `${score(v.indicateurs.score)}/100${s.controlePerime ? ' · à recalculer' : ''}` : 'À calculer';
      }
      case 'ecarts': return s.analyse ? `${s.nbHomogenes} homogène(s)` : 'RC à importer';
      case 'densification': return s.densification
        ? `${score(s.densification.score)}/100${s.densificationPerimee ? ' · à recalculer' : ''}`
        : `${s.nouveaux.length} point(s) nouveau(x)`;
      default: return `${s.listeFonds.length} fond(s)`;
    }
  }

  termine(o: OngletReseau): boolean {
    const s = this.store;
    return (o === 'points' && s.anciensRetenus.length >= 3)
      || (o === 'controle' && !!s.controle && !s.controlePerime)
      || (o === 'ecarts' && !!s.analyse)
      || (o === 'densification' && !!s.densification && !s.densificationPerimee);
  }

  get legende(): StylePoint[] { return LEGENDE[this.store.onglet]; }

  clicCarte(e: { lat: number; lon: number }): void {
    if (this.store.modeAjoutCarte) this.store.ajouterNouveauDepuisCarte(e.lat, e.lon);
  }
}
