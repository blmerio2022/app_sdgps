import { Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { OngletReseau, ReseauGpsStore } from '../reseau-gps.store';
import { COULEURS_POINTS, LIBELLES_POINTS, ReseauCarteComponent, StylePoint } from '../reseau-carte/reseau-carte.component';
import { fr } from '../onglets/onglet-controle.component';

interface DefOnglet { code: OngletReseau; titre: string; icone: string; etape: number | null; }

/** Légende de la carte selon l'onglet (seuls les éléments qu'il affiche). */
const LEGENDE: Record<OngletReseau, StylePoint[]> = {
  points: ['ancien', 'ecarte'],
  controle: ['ancien', 'ecarte', 'suggere'],
  ecarts: ['homogene', 'non_homogene', 'non_controle'],
  densification: ['homogene', 'propose', 'nouveau'],
  zones: ['ancien', 'ecarte'],
  fonds: [],
};

/**
 * Module « Réseau de triangulation GNSS ». Les onglets suivent le travail de densification
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
export class ReseauGpsPageComponent implements OnInit, OnDestroy {
  readonly onglets: DefOnglet[] = [
    { code: 'points', titre: 'Points anciens', icone: 'fas fa-map-marker-alt', etape: 1 },
    { code: 'controle', titre: 'Réseau de contrôle', icone: 'fas fa-project-diagram', etape: 2 },
    { code: 'ecarts', titre: 'Contrôle des écarts', icone: 'fas fa-ruler-combined', etape: 3 },
    { code: 'densification', titre: 'Densification', icone: 'fas fa-map-pin', etape: 4 },
    { code: 'zones', titre: 'Zones', icone: 'fas fa-draw-polygon', etape: null },
    { code: 'fonds', titre: 'Fonds de carte', icone: 'fas fa-layer-group', etape: null },
  ];
  readonly couleurs = COULEURS_POINTS;
  readonly libelles = LIBELLES_POINTS;
  readonly fr = fr;
  etiquettesDistances = true;
  afficherTriangles = true;
  /** Carte élargie à toute la page (Échap pour quitter). */
  pleinEcran = false;
  @ViewChild('carte') carte?: ReseauCarteComponent;
  private abonnement?: Subscription;

  constructor(public store: ReseauGpsStore) {}

  ngOnInit(): void {
    this.store.init();
    this.abonnement = this.store.cadrerZones$.subscribe(ids => { if (ids?.length) setTimeout(() => this.carte?.cadrerSurZones(ids)); });
    this.abonnement.add(this.store.cadrerNoms$.subscribe(noms => { if (noms?.length) this.carte?.cadrerSurNoms(noms); }));
  }

  ngOnDestroy(): void { this.abonnement?.unsubscribe(); }

  /** Mode de clic transmis à la carte. */
  get outilCarte(): 'aucun' | 'dessin' | 'lignes' {
    return this.store.modeDessinZone ? 'dessin' : this.store.editionLignes ? 'lignes' : 'aucun';
  }

  basculerPleinEcran(): void { this.pleinEcran = !this.pleinEcran; }

  /** Quitter la page avec du travail non enregistré : le navigateur demande confirmation. */
  @HostListener('window:beforeunload', ['$event'])
  avantDeQuitter(e: BeforeUnloadEvent): void {
    if (this.store.modifie && (this.store.anciens.length || this.store.zones.length)) { e.preventDefault(); e.returnValue = ''; }
  }

  @HostListener('document:keydown.escape')
  quitterPleinEcran(): void {
    if (this.pleinEcran && !this.store.modeDessinZone && !this.store.editionLignes) this.pleinEcran = false;
  }

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
      case 'zones': return s.zones.length ? `${s.zones.length} zone(s)` : 'Import ou tracé';
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
