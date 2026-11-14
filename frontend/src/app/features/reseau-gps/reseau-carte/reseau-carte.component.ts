import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output,
  SimpleChanges, ViewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { LigneBase, SuggestionPoint, TriangleResultat } from '../../../core/services/reseau-gps.service';
import { FondCarte } from '../fonds-carte';

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
}

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
  ecarte: 'Point ancien écarté',
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
  zone: '#8e44ad', nonCouvert: '#e74c3c', marque: '#e67e22',
};

export function echapper(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export function nombreFr(n: number | null | undefined, dec = 3): string {
  return n === null || n === undefined || isNaN(n) ? '—'
    : n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function popupPoint(p: PointCarte): string {
  const degre = p.degre !== undefined ? `<tr><th>Lignes de base</th><td>${p.degre}</td></tr>` : '';
  const note = p.note ? `<p>${echapper(p.note)}</p>` : '';
  return `<div class="rg-popup"><strong>${echapper(p.nom_point)}</strong> <em>${LIBELLES_POINTS[p.style]}</em>
    <table>
      <tr><th>Référence</th><td>${echapper(p.reference) || '—'}</td></tr>
      <tr><th>Matérialisation</th><td>${echapper(p.nature_materialisation) || '—'}</td></tr>
      <tr><th>Signalisation</th><td>${echapper(p.nature_signalisation) || '—'}</td></tr>
      <tr><th>X / Y (m)</th><td>${nombreFr(p.x_m, 2)} / ${nombreFr(p.y_m, 2)}</td></tr>
      <tr><th>Lat / Lon</th><td>${p.lat.toFixed(6)} / ${p.lon.toFixed(6)}</td></tr>
      ${degre}
    </table>${note}</div>`;
}

export function popupLigne(l: LigneCarte, points: PointCarte[]): string {
  const a = echapper(points[l.de]?.nom_point ?? l.de);
  const b = echapper(points[l.a]?.nom_point ?? l.a);
  if (l.style === 'incompatible') {
    return `<div class="rg-popup"><strong>${a} ↔ ${b}</strong> <em>Écart hors tolérance</em>
      <table><tr><th>ΔD</th><td>${nombreFr(l.ecart_m, 3)} m</td></tr>
      <tr><th>Distance</th><td>${nombreFr(l.distance_km)} km</td></tr></table></div>`;
  }
  return `<div class="rg-popup"><strong>${a} → ${b}</strong>
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

/**
 * Carte Leaflet du réseau : fond, zone à densifier et zones non couvertes, triangles,
 * lignes de base (distance en km), écarts hors tolérance, points (fiche LPA), emplacements
 * à rechercher. En mode « placer un point », un clic émet ses coordonnées.
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
  @Output() clicCarte = new EventEmitter<{ lat: number; lon: number }>();

  @ViewChild('conteneur', { static: true }) conteneur!: ElementRef<HTMLDivElement>;

  carte: L.Map | null = null;
  coucheFond: L.TileLayer | null = null;
  coucheReseau: L.LayerGroup | null = null;
  private observateur: ResizeObserver | null = null;
  private signatureCadrage = '';

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    // Hors zone Angular : survols, chargements de tuiles et animations Leaflet ne relancent
    // pas la détection de changements ; seul le clic utile y revient (zone.run).
    this.zone.runOutsideAngular(() => this.initialiser());
  }

  private initialiser(): void {
    this.carte = L.map(this.conteneur.nativeElement, { zoomControl: true, attributionControl: true })
      .setView([31.8, -7.1], 6);
    L.control.scale({ imperial: false }).addTo(this.carte);
    this.coucheReseau = L.layerGroup().addTo(this.carte);
    this.carte.on('click', (e: L.LeafletMouseEvent) => {
      if (this.modeAjout) this.zone.run(() => this.clicCarte.emit({ lat: e.latlng.lat, lon: e.latlng.lng }));
    });
    this.appliquerFond();
    this.dessiner();
    if (typeof ResizeObserver !== 'undefined') {
      this.observateur = new ResizeObserver(() => this.carte?.invalidateSize());
      this.observateur.observe(this.conteneur.nativeElement);
    }
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.carte) return;
    this.zone.runOutsideAngular(() => {
      if (ch['fond']) this.appliquerFond();
      if (ch['vue'] || ch['etiquettesDistances'] || ch['afficherTriangles']) this.dessiner();
    });
  }

  ngOnDestroy(): void {
    this.observateur?.disconnect();
    this.carte?.remove();
    this.carte = null;
  }

  private appliquerFond(): void {
    if (!this.carte) return;
    if (this.coucheFond) {
      this.carte.removeLayer(this.coucheFond);
      this.coucheFond = null;
    }
    const f = this.fond;
    if (!f || !f.url) return;
    const options = { attribution: f.attribution || '', maxZoom: 20, maxNativeZoom: f.maxZoom || 19 };
    this.coucheFond = f.type === 'wms'
      ? L.tileLayer.wms(f.url, { ...options, layers: f.couches || '', format: f.format || 'image/png', transparent: false })
      : L.tileLayer(f.url, options);
    this.coucheFond.addTo(this.carte);
    this.coucheFond.bringToBack();
  }

  /** (Re)dessine la vue ; recadre seulement quand l'ensemble des points change. */
  dessiner(): void {
    if (!this.carte || !this.coucheReseau) return;
    const couche = this.coucheReseau;
    couche.clearLayers();
    const v = this.vue;
    if (!v || !v.points.length) return;
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
        L.polygon(t.sommets.map(pos), { stroke: false, fillColor: couleur, fillOpacity: 0.12 })
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
        color: couleur, weight: incompatible ? 2 : 2.5, opacity: 0.9, dashArray: pointille ? '6 6' : undefined,
      });
      trait.bindPopup(popupLigne(l, v.points));
      trait.bindTooltip(incompatible ? `ΔD ${nombreFr(l.ecart_m, 2)} m` : `${nombreFr(l.distance_km)} km`, {
        permanent: this.etiquettesDistances, direction: 'center', className: 'rg-etiquette',
      });
      trait.addTo(couche);
    });

    (v.suggestions || []).forEach(s => {
      L.circle([s.lat, s.lon], {
        radius: s.rayon_recherche_m, color: COULEURS_POINTS.suggere, weight: 1.5, dashArray: '4 4',
        fillColor: COULEURS_POINTS.suggere, fillOpacity: 0.12,
      }).bindPopup(`<div class="rg-popup"><strong>${echapper(s.nom_point)}</strong> <em>Zone de recherche</em>
          <p>${echapper(s.justification)}</p></div>`).addTo(couche);
    });

    v.points.forEach(p => {
      if (p.marque) {
        L.circleMarker([p.lat, p.lon], { radius: 12, weight: 2.5, color: COULEURS.marque, fill: false, dashArray: '3 3' })
          .addTo(couche);
      }
      L.circleMarker([p.lat, p.lon], {
        radius: p.style === 'suggere' || p.style === 'propose' ? 7 : 6, weight: 2, color: '#ffffff',
        fillColor: COULEURS_POINTS[p.style] || COULEURS_POINTS.ancien, fillOpacity: p.style === 'ecarte' ? 0.6 : 1,
      })
        .bindPopup(popupPoint(p))
        .bindTooltip(echapper(p.nom_point), { permanent: true, direction: 'top', offset: [0, -6], className: 'rg-nom' })
        .addTo(couche);
    });

    const signature = v.points.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).sort().join(';');
    if (signature !== this.signatureCadrage) {
      this.signatureCadrage = signature;
      this.cadrer();
    }
  }

  cadrer(): void {
    const v = this.vue;
    if (!this.carte || !v || !v.points.length) return;
    const limites = L.latLngBounds(v.points.map(p => [p.lat, p.lon] as L.LatLngTuple));
    this.carte.fitBounds(limites.pad(0.15), { maxZoom: 17 });
  }

  recadrer(): void { this.cadrer(); }
}
