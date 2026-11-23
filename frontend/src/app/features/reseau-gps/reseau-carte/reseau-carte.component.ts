import {
  AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, Output,
  SimpleChanges, ViewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { LigneBase, SuggestionPoint, TriangleResultat, TypeZone } from '../../../core/services/reseau-gps.service';
import { FondCarte } from '../fonds-carte';
import { wgs84VersLambert } from '../lambert-maroc';
import {
  Xy, aire, angleAuSommet, formatAire, formatAngle, formatDistance, gisement, longueur, perimetre,
} from '../mesures.util';

/** Rôle d'un point sur la carte (couleur + légende). */
export type StylePoint =
  'ancien' | 'ecarte' | 'homogene' | 'non_homogene' | 'non_controle' | 'nouveau' | 'propose' | 'suggere';

export interface PointCarte {
  nom_point: string;
  x_m: number; y_m: number; lat: number; lon: number;
  style: StylePoint;
  reference?: string; nature_materialisation?: string; nature_signalisation?: string;
  degre?: number;
  /** Information complémentaire (motif d'écart, proposition de suppression…). */
  note?: string;
  /** Point signalé (proposition de suppression) : cerclé d'orange. */
  marque?: boolean;
}

export interface LigneCarte extends LigneBase {
  /** `incompatible` : paire de points anciens dont l'écart ΔD dépasse la tolérance. */
  style?: 'incompatible';
  ecart_m?: number;
  /** Ligne d'un réseau personnalisé (éditable). */
  perso?: boolean;
}

/** Zone de travail affichée (polygones WGS84 : [extérieur, trous…] de [lat, lon]). */
export interface ZoneCarte {
  id: string; nom: string; type: TypeZone; couleur: string;
  polygones: number[][][][];
  active: boolean; selectionnee: boolean;
}

/** Ce que la carte affiche pour l'onglet courant. */
export interface VueCarte {
  points: PointCarte[];
  lignes: LigneCarte[];
  triangles: TriangleResultat[];
  suggestions?: SuggestionPoint[];
  /** Zone à densifier (enveloppe des anciens homogènes), [lat, lon]. */
  zone?: number[][];
  /** Échantillons de la zone hors couverture N11, [lat, lon]. */
  nonCouverts?: number[][];
  /** Zones de l'opérateur (levées / à densifier). */
  zones?: ZoneCarte[];
  /** Point de départ d'une ligne en cours d'édition. */
  selection?: string;
}

/** Outil de capture de la carte (mesures, tracé d'une zone). */
export type OutilCapture = 'aucun' | 'distance' | 'aire' | 'angle';

export const COULEURS_POINTS: Record<StylePoint, string> = {
  ancien: '#2e86de',
  ecarte: '#7f8c8d',
  homogene: '#27ae60',
  non_homogene: '#e74c3c',
  non_controle: '#95a5a6',
  nouveau: '#cc5858',
  propose: '#8e44ad',
  suggere: '#d9a441',
};

export const LIBELLES_POINTS: Record<StylePoint, string> = {
  ancien: 'Point ancien',
  ecarte: 'Point ancien désactivé',
  homogene: 'Point ancien homogène',
  non_homogene: 'Point ancien non homogène',
  non_controle: 'Point ancien non contrôlé',
  nouveau: 'Point nouveau (placé à la main)',
  propose: 'Point nouveau proposé',
  suggere: 'Emplacement à rechercher',
};

const COULEURS = {
  ligne: '#2ecc71', ligneHorsBoucle: '#e67e22', ligneTropLongue: '#e74c3c', incompatible: '#e74c3c',
  triangleConforme: '#2ecc71', triangleNonConforme: '#d9a441', triangleDefectueux: '#e74c3c',
  zone: '#8e44ad', nonCouvert: '#e74c3c', marque: '#e67e22', selection: '#f1c40f', mesure: '#00bcd4',
};

export function echapper(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export function nombreFr(n: number | null | undefined, dec = 3): string {
  return n === null || n === undefined || isNaN(n) ? '—'
    : n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function popupPoint(p: PointCarte, action = false): string {
  const degre = p.degre !== undefined ? `<tr><th>Lignes de base</th><td>${p.degre}</td></tr>` : '';
  const note = p.note ? `<p>${echapper(p.note)}</p>` : '';
  const actif = p.style !== 'ecarte';
  const bouton = action
    ? `<button type="button" class="rg-popup-action${actif ? '' : ' activer'}" data-nom="${echapper(p.nom_point)}">
         ${actif ? 'Désactiver ce point' : 'Activer ce point'}</button>` : '';
  return `<div class="rg-popup"><strong>${echapper(p.nom_point)}</strong> <em>${LIBELLES_POINTS[p.style]}</em>
    <table>
      <tr><th>Référence</th><td>${echapper(p.reference) || '—'}</td></tr>
      <tr><th>Matérialisation</th><td>${echapper(p.nature_materialisation) || '—'}</td></tr>
      <tr><th>Signalisation</th><td>${echapper(p.nature_signalisation) || '—'}</td></tr>
      <tr><th>X / Y (m)</th><td>${nombreFr(p.x_m, 2)} / ${nombreFr(p.y_m, 2)}</td></tr>
      <tr><th>Lat / Lon</th><td>${p.lat.toFixed(6)} / ${p.lon.toFixed(6)}</td></tr>
      ${degre}
    </table>${note}${bouton}</div>`;
}

export function popupLigne(l: LigneCarte, points: PointCarte[]): string {
  const a = echapper(points[l.de]?.nom_point ?? l.de);
  const b = echapper(points[l.a]?.nom_point ?? l.a);
  if (l.style === 'incompatible') {
    return `<div class="rg-popup"><strong>${a} ↔ ${b}</strong> <em>Écart hors tolérance</em>
      <table><tr><th>ΔD</th><td>${nombreFr(l.ecart_m, 3)} m</td></tr>
      <tr><th>Distance</th><td>${nombreFr(l.distance_km)} km</td></tr></table></div>`;
  }
  return `<div class="rg-popup"><strong>${a} → ${b}</strong>${l.perso ? ' <em>Réseau personnalisé</em>' : ''}
    <table>
      <tr><th>Distance</th><td>${nombreFr(l.distance_km)} km</td></tr>
      <tr><th>Gisement</th><td>${nombreFr(l.azimut_deg, 2)}°</td></tr>
      <tr><th>Dans une boucle</th><td>${l.en_boucle ? 'Oui' : 'Non (N4)'}</td></tr>
      <tr><th>Longueur</th><td>${l.trop_longue ? 'Trop longue (N7)' : 'Conforme'}</td></tr>
    </table></div>`;
}

export function popupTriangle(t: TriangleResultat, points: PointCarte[]): string {
  const lignes = t.sommets.map((s, k) =>
    `<tr><th>${echapper(points[s]?.nom_point ?? s)}</th><td>${nombreFr(t.angles_deg[k], 2)}°</td></tr>`).join('');
  const etat = t.defectueux ? 'Défectueux (N1b)' : t.conforme ? 'Conforme (N1)' : 'Hors [30° ; 120°] (N1)';
  return `<div class="rg-popup"><strong>Triangle</strong> <em>${etat}</em><table>${lignes}</table></div>`;
}

const LIBELLE_TYPE_ZONE: Record<TypeZone, string> = { levee: 'Zone levée', densification: 'Zone de densification' };

/** Résultat textuel d'une mesure (affiché dans le panneau et sur la carte). */
export function texteMesure(outil: OutilCapture, plan: Xy[]): string[] {
  if (outil === 'distance' && plan.length >= 2) {
    const l = longueur(plan);
    const lignes = [`Distance : ${formatDistance(l.totale)}`];
    if (l.segments.length > 1) lignes.push(`${l.segments.length} segments : ${l.segments.map(formatDistance).join(' + ')}`);
    lignes.push(`Gisement du dernier segment : ${formatAngle(gisement(plan[plan.length - 2], plan[plan.length - 1]))}`);
    return lignes;
  }
  if (outil === 'aire' && plan.length >= 3) {
    return [`Surface : ${formatAire(aire(plan))}`, `Périmètre : ${formatDistance(perimetre(plan))}`];
  }
  if (outil === 'angle' && plan.length === 3) {
    return [`Angle au sommet : ${formatAngle(angleAuSommet(plan[0], plan[1], plan[2]))}`,
            `Côtés : ${formatDistance(Math.hypot(plan[0][0] - plan[1][0], plan[0][1] - plan[1][1]))} et `
            + formatDistance(Math.hypot(plan[2][0] - plan[1][0], plan[2][1] - plan[1][1]))];
  }
  return [];
}

const CONSIGNES: Record<string, string> = {
  distance: 'Cliquez les sommets ; double-clic pour terminer.',
  aire: 'Cliquez les sommets de la surface ; double-clic pour fermer.',
  angle: 'Cliquez un point, puis le sommet de l\'angle, puis un second point.',
  dessin: 'Cliquez les sommets de la zone ; double-clic pour fermer. Retour arrière : annuler un sommet.',
};

/**
 * Carte Leaflet du réseau : fond, zones de l'opérateur, zone à densifier et zones non
 * couvertes, triangles, lignes de base, écarts hors tolérance, points (fiche LPA),
 * emplacements à rechercher.
 *
 * Barre d'outils façon QGIS : zoom avant / arrière, emprise, vues précédente / suivante,
 * mesure de distance, de surface et d'angle (dans le plan Lambert), plein écran ; coordonnées
 * du curseur (WGS84 + Lambert). Modes de clic : placer un point (`modeAjout`), tracer une
 * zone (`outil = 'dessin'`), éditer les lignes d'un réseau personnalisé (`outil = 'lignes'`).
 */
@Component({
  selector: 'app-reseau-carte',
  templateUrl: './reseau-carte.component.html',
  styleUrls: ['./reseau-carte.component.scss'],
})
export class ReseauCarteComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() vue: VueCarte | null = null;
  @Input() fond: FondCarte | null = null;
  @Input() etiquettesDistances = true;
  @Input() afficherTriangles = true;
  @Input() modeAjout = false;
  /** Mode de clic : tracé d'une zone ou édition des lignes de base. */
  @Input() outil: 'aucun' | 'dessin' | 'lignes' = 'aucun';
  /** Zone Lambert des coordonnées (mesures, coordonnées du curseur). */
  @Input() zoneLambert = 'nord';
  /** Les fiches des points proposent « Activer / Désactiver ». */
  @Input() actionsPoints = false;
  @Input() pleinEcran = false;

  @Output() clicCarte = new EventEmitter<{ lat: number; lon: number }>();
  @Output() zoneDessinee = new EventEmitter<number[][]>();
  @Output() clicPoint = new EventEmitter<string>();
  @Output() clicLigne = new EventEmitter<{ a: string; b: string }>();
  @Output() actionPoint = new EventEmitter<string>();
  @Output() basculerPleinEcran = new EventEmitter<void>();
  @Output() annulerOutil = new EventEmitter<void>();

  @ViewChild('conteneur', { static: true }) conteneur!: ElementRef<HTMLDivElement>;
  @ViewChild('coords', { static: true }) coords!: ElementRef<HTMLDivElement>;

  carte: L.Map | null = null;
  coucheFond: L.TileLayer | null = null;
  coucheReseau: L.LayerGroup | null = null;
  coucheMesures: L.LayerGroup | null = null;
  private coucheCapture: L.LayerGroup | null = null;
  private observateur: ResizeObserver | null = null;
  private signatureCadrage = '';

  /** Outil de mesure actif (le tracé de zone est piloté par `outil`). */
  outilMesure: OutilCapture = 'aucun';
  sommets: L.LatLng[] = [];
  resultats: { titre: string; lignes: string[] }[] = [];
  /** Historique des vues (précédente / suivante). */
  private historique: { centre: L.LatLng; zoom: number }[] = [];
  private positionHistorique = -1;
  private navigationHistorique = false;

  constructor(private zone: NgZone) {}

  get captureActive(): 'dessin' | OutilCapture {
    return this.outil === 'dessin' ? 'dessin' : this.outilMesure;
  }

  get consigne(): string { return CONSIGNES[this.captureActive] || ''; }

  ngAfterViewInit(): void {
    // Hors zone Angular : survols, chargements de tuiles et animations Leaflet ne relancent
    // pas la détection de changements ; seuls les événements utiles y reviennent (zone.run).
    this.zone.runOutsideAngular(() => this.initialiser());
  }

  private initialiser(): void {
    this.carte = L.map(this.conteneur.nativeElement, { zoomControl: false, attributionControl: true })
      .setView([31.8, -7.1], 6);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(this.carte);
    this.coucheReseau = L.layerGroup().addTo(this.carte);
    this.coucheMesures = L.layerGroup().addTo(this.carte);
    this.coucheCapture = L.layerGroup().addTo(this.carte);
    this.carte.on('click', (e: L.LeafletMouseEvent) => this.surClic(e));
    this.carte.on('dblclick', () => this.terminerCapture());
    this.carte.on('mousemove', (e: L.LeafletMouseEvent) => this.surMouvement(e));
    this.carte.on('mouseout', () => { if (this.coords) this.coords.nativeElement.textContent = ''; });
    this.carte.on('moveend', () => this.memoriserVue());
    this.carte.on('popupopen', (e: L.PopupEvent) => this.brancherActionPopup(e));
    this.appliquerFond();
    this.dessiner();
    this.memoriserVue();
    if (typeof ResizeObserver !== 'undefined') {
      this.observateur = new ResizeObserver(() => this.carte?.invalidateSize());
      this.observateur.observe(this.conteneur.nativeElement);
    }
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.carte) return;
    this.zone.runOutsideAngular(() => {
      if (ch['fond']) this.appliquerFond();
      if (ch['outil']) {
        this.annulerCapture();
        if (this.outil !== 'aucun') this.outilMesure = 'aucun';
        this.majDoubleClic();
      }
      if (ch['vue'] || ch['etiquettesDistances'] || ch['afficherTriangles'] || ch['outil'] || ch['actionsPoints']) {
        this.dessiner();
      }
    });
  }

  ngOnDestroy(): void {
    this.observateur?.disconnect();
    this.carte?.remove();
    this.carte = null;
  }

  @HostListener('document:keydown', ['$event'])
  surTouche(e: KeyboardEvent): void {
    if (this.captureActive === 'aucun') return;
    const cible = e.target as HTMLElement | null;
    if (cible && ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.sommets.length) this.annulerCapture();
      else if (this.outilMesure !== 'aucun') this.choisirMesure('aucun');
      else this.annulerOutil.emit();
    } else if (e.key === 'Backspace' && this.sommets.length) {
      e.preventDefault();
      this.sommets.pop();
      this.dessinerCapture();
    }
  }

  // ------------------------------------------------------------------ fond

  private appliquerFond(): void {
    if (!this.carte) return;
    if (this.coucheFond) {
      this.carte.removeLayer(this.coucheFond);
      this.coucheFond = null;
    }
    const f = this.fond;
    if (!f || !f.url) return;
    const options: L.TileLayerOptions = {
      attribution: f.attribution || '', maxZoom: 21, maxNativeZoom: f.maxZoom || 19,
      ...(f.sousDomaines ? { subdomains: f.sousDomaines } : {}),
    };
    this.coucheFond = f.type === 'wms'
      ? L.tileLayer.wms(f.url, { ...options, layers: f.couches || '', format: f.format || 'image/png', transparent: false })
      : L.tileLayer(f.url, options);
    this.coucheFond.addTo(this.carte);
    this.coucheFond.bringToBack();
  }

  // ------------------------------------------------------------------ dessin du réseau

  private get modeClic(): boolean { return this.modeAjout || this.captureActive !== 'aucun'; }

  /** (Re)dessine la vue ; recadre seulement quand l'ensemble des points / zones change. */
  dessiner(): void {
    if (!this.carte || !this.coucheReseau) return;
    const couche = this.coucheReseau;
    couche.clearLayers();
    const v = this.vue;
    if (!v) return;
    const interactif = !this.modeClic;
    const edition = this.outil === 'lignes';

    (v.zones || []).forEach(z => {
      const forme = L.polygon(z.polygones as unknown as L.LatLngExpression[][][], {
        color: z.couleur, weight: z.selectionnee ? 3.5 : 2, opacity: z.active ? 0.95 : 0.5,
        dashArray: z.active ? undefined : '5 6', fillColor: z.couleur,
        fillOpacity: z.active ? (z.selectionnee ? 0.22 : 0.12) : 0.04, interactive: interactif && !edition,
      });
      forme.bindTooltip(echapper(z.nom), { sticky: true, className: 'rg-etiquette' });
      forme.bindPopup(`<div class="rg-popup"><strong>${echapper(z.nom)}</strong> <em>${LIBELLE_TYPE_ZONE[z.type]}</em>
        ${z.active ? '' : '<p>Non prise en compte dans les calculs.</p>'}</div>`);
      forme.addTo(couche);
    });

    if (!v.points.length) {
      this.cadrerSiNouveau(v);
      return;
    }
    const pos = (i: number): L.LatLngExpression => [v.points[i].lat, v.points[i].lon];

    if (v.zone?.length) {
      L.polygon(v.zone as L.LatLngTuple[], {
        color: COULEURS.zone, weight: 1.5, dashArray: '8 6', fill: false, interactive: false,
      }).addTo(couche);
    }
    (v.nonCouverts || []).forEach(c => L.circleMarker(c as L.LatLngTuple, {
      radius: 3, stroke: false, fillColor: COULEURS.nonCouvert, fillOpacity: 0.55, interactive: false,
    }).addTo(couche));

    if (this.afficherTriangles) {
      v.triangles.forEach(t => {
        const couleur = t.defectueux ? COULEURS.triangleDefectueux
          : t.conforme ? COULEURS.triangleConforme : COULEURS.triangleNonConforme;
        L.polygon(t.sommets.map(pos), { stroke: false, fillColor: couleur, fillOpacity: 0.12, interactive: interactif })
          .bindPopup(popupTriangle(t, v.points)).addTo(couche);
      });
    }

    v.lignes.forEach(l => {
      const incompatible = l.style === 'incompatible';
      const couleur = incompatible ? COULEURS.incompatible : l.trop_longue ? COULEURS.ligneTropLongue
        : l.en_boucle ? COULEURS.ligne : COULEURS.ligneHorsBoucle;
      const pointille = incompatible || ['suggere', 'propose'].includes(v.points[l.de]?.style)
        || ['suggere', 'propose'].includes(v.points[l.a]?.style);
      const trait = L.polyline([pos(l.de), pos(l.a)], {
        color: couleur, weight: edition ? 5 : incompatible ? 2 : 2.5, opacity: 0.9,
        dashArray: pointille ? '6 6' : undefined, interactive: interactif || edition,
      });
      if (edition) {
        const a = v.points[l.de]?.nom_point, b = v.points[l.a]?.nom_point;
        trait.bindTooltip(`${echapper(a)} – ${echapper(b)} · ${nombreFr(l.distance_km)} km — cliquer pour retirer`,
          { sticky: true, className: 'rg-etiquette' });
        trait.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          this.zone.run(() => this.clicLigne.emit({ a, b }));
        });
      } else {
        trait.bindPopup(popupLigne(l, v.points));
        trait.bindTooltip(incompatible ? `ΔD ${nombreFr(l.ecart_m, 2)} m` : `${nombreFr(l.distance_km)} km`, {
          permanent: this.etiquettesDistances, direction: 'center', className: 'rg-etiquette',
        });
      }
      trait.addTo(couche);
    });

    (v.suggestions || []).forEach(s => {
      L.circle([s.lat, s.lon], {
        radius: s.rayon_recherche_m, color: COULEURS_POINTS.suggere, weight: 1.5, dashArray: '4 4',
        fillColor: COULEURS_POINTS.suggere, fillOpacity: 0.12, interactive: interactif,
      }).bindPopup(`<div class="rg-popup"><strong>${echapper(s.nom_point)}</strong> <em>Zone de recherche</em>
          <p>${echapper(s.justification)}</p></div>`).addTo(couche);
    });

    v.points.forEach(p => {
      if (p.marque) {
        L.circleMarker([p.lat, p.lon], { radius: 12, weight: 2.5, color: COULEURS.marque, fill: false, dashArray: '3 3',
                                          interactive: false }).addTo(couche);
      }
      if (v.selection && v.selection === p.nom_point) {
        L.circleMarker([p.lat, p.lon], { radius: 14, weight: 3, color: COULEURS.selection, fill: false, interactive: false })
          .addTo(couche);
      }
      const marqueur = L.circleMarker([p.lat, p.lon], {
        radius: edition ? 8 : (p.style === 'suggere' || p.style === 'propose' ? 7 : 6), weight: 2, color: '#ffffff',
        fillColor: COULEURS_POINTS[p.style] || COULEURS_POINTS.ancien, fillOpacity: p.style === 'ecarte' ? 0.6 : 1,
        interactive: interactif || edition,
      }).bindTooltip(echapper(p.nom_point), { permanent: true, direction: 'top', offset: [0, -6], className: 'rg-nom' });
      if (edition) {
        marqueur.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          this.zone.run(() => this.clicPoint.emit(p.nom_point));
        });
      } else {
        marqueur.bindPopup(popupPoint(p, this.actionsPoints));
      }
      marqueur.addTo(couche);
    });

    this.cadrerSiNouveau(v);
  }

  private cadrerSiNouveau(v: VueCarte): void {
    const signature = [
      ...v.points.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).sort(),
      ...(v.points.length ? [] : (v.zones || []).map(z => z.id)),
    ].join(';');
    if (signature && signature !== this.signatureCadrage) {
      this.signatureCadrage = signature;
      this.cadrer();
    }
  }

  /** Bouton « Activer / Désactiver » des fiches de points. */
  private brancherActionPopup(e: L.PopupEvent): void {
    const bouton = e.popup.getElement()?.querySelector<HTMLButtonElement>('.rg-popup-action');
    if (!bouton) return;
    bouton.onclick = () => {
      const nom = bouton.getAttribute('data-nom') || '';
      this.carte?.closePopup();
      this.zone.run(() => this.actionPoint.emit(nom));
    };
  }

  // ------------------------------------------------------------------ navigation

  private limitesContenu(ids?: string[]): L.LatLngBounds | null {
    const v = this.vue;
    if (!v) return null;
    const coords: L.LatLngTuple[] = [];
    if (!ids) v.points.forEach(p => coords.push([p.lat, p.lon]));
    (v.zones || []).filter(z => !ids || ids.includes(z.id))
      .forEach(z => z.polygones.forEach(poly => poly[0].forEach(([la, lo]) => coords.push([la, lo]))));
    return coords.length ? L.latLngBounds(coords) : null;
  }

  cadrer(): void {
    const b = this.limitesContenu();
    if (this.carte && b) this.carte.fitBounds(b.pad(0.15), { maxZoom: 17 });
  }

  recadrer(): void { this.cadrer(); }

  /** Recadre sur des zones précises (après import ou sélection). */
  cadrerSurZones(ids: string[]): void {
    const b = this.limitesContenu(ids);
    if (this.carte && b) this.zone.runOutsideAngular(() => this.carte!.fitBounds(b.pad(0.2), { maxZoom: 17 }));
  }

  zoomer(sens: 1 | -1): void { sens > 0 ? this.carte?.zoomIn() : this.carte?.zoomOut(); }

  private memoriserVue(): void {
    if (!this.carte) return;
    if (this.navigationHistorique) { this.navigationHistorique = false; return; }
    const vue = { centre: this.carte.getCenter(), zoom: this.carte.getZoom() };
    const derniere = this.historique[this.positionHistorique];
    if (derniere && derniere.zoom === vue.zoom && derniere.centre.equals(vue.centre, 1e-7)) return;
    this.historique = [...this.historique.slice(0, this.positionHistorique + 1), vue].slice(-50);
    this.positionHistorique = this.historique.length - 1;
  }

  get peutReculer(): boolean { return this.positionHistorique > 0; }
  get peutAvancer(): boolean { return this.positionHistorique < this.historique.length - 1; }

  vueHistorique(pas: -1 | 1): void {
    const cible = this.positionHistorique + pas;
    const vue = this.historique[cible];
    if (!vue || !this.carte) return;
    this.positionHistorique = cible;
    this.navigationHistorique = true;
    this.carte.setView(vue.centre, vue.zoom);
  }

  // ------------------------------------------------------------------ mesures et tracé

  choisirMesure(o: OutilCapture): void {
    this.outilMesure = this.outilMesure === o ? 'aucun' : o;
    this.annulerCapture();
    this.majDoubleClic();
    if (this.outilMesure !== 'aucun' && this.outil !== 'aucun') this.annulerOutil.emit();
    this.dessiner();
  }

  effacerMesures(): void {
    this.coucheMesures?.clearLayers();
    this.resultats = [];
    this.annulerCapture();
  }

  private majDoubleClic(): void {
    if (!this.carte) return;
    if (this.captureActive === 'aucun') this.carte.doubleClickZoom.enable();
    else this.carte.doubleClickZoom.disable();
  }

  private surClic(e: L.LeafletMouseEvent): void {
    if (this.captureActive !== 'aucun') {
      const dernier = this.sommets[this.sommets.length - 1];
      if (dernier && this.carte && this.carte.latLngToContainerPoint(dernier)
        .distanceTo(this.carte.latLngToContainerPoint(e.latlng)) < 3) return;   // 2e clic d'un double-clic
      this.sommets.push(e.latlng);
      if (this.captureActive === 'angle' && this.sommets.length === 3) this.terminerCapture();
      else this.dessinerCapture();
      return;
    }
    if (this.modeAjout) this.zone.run(() => this.clicCarte.emit({ lat: e.latlng.lat, lon: e.latlng.lng }));
  }

  private plan(points: L.LatLng[]): Xy[] {
    return points.map(p => wgs84VersLambert(p.lat, p.lng, this.zoneLambert));
  }

  private surMouvement(e: L.LeafletMouseEvent): void {
    if (this.coords) {
      const [x, y] = wgs84VersLambert(e.latlng.lat, e.latlng.lng, this.zoneLambert);
      this.coords.nativeElement.textContent =
        `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}  ·  X ${nombreFr(x, 2)}  Y ${nombreFr(y, 2)}`;
    }
    if (this.sommets.length && this.captureActive !== 'aucun') this.dessinerCapture(e.latlng);
  }

  /** Tracé provisoire (avec l'élastique jusqu'au curseur) et résultat en direct. */
  private dessinerCapture(curseur?: L.LatLng): void {
    const couche = this.coucheCapture;
    if (!couche) return;
    couche.clearLayers();
    const pts = curseur ? [...this.sommets, curseur] : [...this.sommets];
    const surface = this.captureActive === 'aire' || this.captureActive === 'dessin';
    const couleur = this.captureActive === 'dessin' ? COULEURS.zone : COULEURS.mesure;
    if (pts.length >= 2) {
      (surface && pts.length >= 3 ? L.polygon(pts, { color: couleur, weight: 2, dashArray: '6 4', fillOpacity: 0.1, interactive: false })
        : L.polyline(pts, { color: couleur, weight: 2.5, dashArray: '6 4', interactive: false })).addTo(couche);
    }
    this.sommets.forEach(s => L.circleMarker(s, { radius: 4, color: '#fff', weight: 1.5, fillColor: couleur, fillOpacity: 1,
                                                  interactive: false }).addTo(couche));
    const outil = this.captureActive === 'dessin' ? 'aire' : this.captureActive as OutilCapture;
    const texte = texteMesure(outil, this.plan(pts));
    if (texte.length && pts.length) {
      L.tooltip({ permanent: true, direction: 'right', offset: [12, 0], className: 'rg-mesure-direct' })
        .setLatLng(pts[pts.length - 1]).setContent(texte.map(echapper).join('<br>')).addTo(couche);
    }
  }

  private annulerCapture(): void {
    this.sommets = [];
    this.coucheCapture?.clearLayers();
  }

  /** Double-clic (ou 3e point d'un angle) : la mesure est conservée, la zone émise. */
  private terminerCapture(): void {
    const capture = this.captureActive;
    if (capture === 'aucun') return;
    const min = capture === 'distance' ? 2 : 3;
    if (this.sommets.length < min) return;
    const pts = [...this.sommets];
    this.annulerCapture();
    if (capture === 'dessin') {
      this.zone.run(() => this.zoneDessinee.emit(pts.map(p => [round8(p.lat), round8(p.lng)])));
      return;
    }
    const texte = texteMesure(capture, this.plan(pts));
    const forme = capture === 'aire'
      ? L.polygon(pts, { color: COULEURS.mesure, weight: 2, fillOpacity: 0.12, interactive: false })
      : L.polyline(pts, { color: COULEURS.mesure, weight: 2.5, interactive: false });
    forme.addTo(this.coucheMesures!);
    pts.forEach(s => L.circleMarker(s, { radius: 3.5, color: '#fff', weight: 1, fillColor: COULEURS.mesure, fillOpacity: 1,
                                         interactive: false }).addTo(this.coucheMesures!));
    L.tooltip({ permanent: true, direction: 'top', className: 'rg-mesure-fixe' })
      .setLatLng(capture === 'angle' ? pts[1] : pts[pts.length - 1])
      .setContent(echapper(texte[0])).addTo(this.coucheMesures!);
    const titres: Record<string, string> = { distance: 'Distance', aire: 'Surface', angle: 'Angle' };
    this.zone.run(() => { this.resultats = [{ titre: titres[capture], lignes: texte }, ...this.resultats].slice(0, 8); });
  }
}

function round8(v: number): number { return Math.round(v * 1e8) / 1e8; }
