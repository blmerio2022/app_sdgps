import {
  AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild,
} from '@angular/core';
import * as L from 'leaflet';
import {
  LigneBase, PointResultat, SuggestionPoint, TriangleResultat,
} from '../../../core/services/reseau-gps.service';
import { FondCarte } from '../fonds-carte';

/** Ce que la carte affiche : une variante (ou la variante parfaite) sur ses points. */
export interface VueCarte {
  points: PointResultat[];
  lignes: LigneBase[];
  triangles: TriangleResultat[];
  suggestions?: SuggestionPoint[];
}

const COULEURS = {
  ancien: '#2e86de',
  nouveau: '#cc5858',
  suggere: '#d9a441',
  ligne: '#2ecc71',
  ligneHorsBoucle: '#e67e22',
  ligneTropLongue: '#e74c3c',
  triangleConforme: '#2ecc71',
  triangleNonConforme: '#d9a441',
  triangleDefectueux: '#e74c3c',
};

export function echapper(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export function nombreFr(n: number | null | undefined, dec = 3): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function libelleStatut(s?: string): string {
  return s === 'nouveau' ? 'Point nouveau' : s === 'suggere' ? 'Emplacement suggéré' : 'Point ancien';
}

export function popupPoint(p: PointResultat): string {
  return `<div class="rg-popup"><strong>${echapper(p.nom_point)}</strong> <em>${libelleStatut(p.statut)}</em>
    <table>
      <tr><th>Référence</th><td>${echapper(p.reference) || '—'}</td></tr>
      <tr><th>Matérialisation</th><td>${echapper(p.nature_materialisation) || '—'}</td></tr>
      <tr><th>Signalisation</th><td>${echapper(p.nature_signalisation) || '—'}</td></tr>
      <tr><th>X / Y (m)</th><td>${nombreFr(p.x_m, 2)} / ${nombreFr(p.y_m, 2)}</td></tr>
      <tr><th>Lat / Lon</th><td>${p.lat.toFixed(6)} / ${p.lon.toFixed(6)}</td></tr>
      <tr><th>Lignes de base</th><td>${p.degre}</td></tr>
    </table></div>`;
}

export function popupLigne(l: LigneBase, points: PointResultat[]): string {
  const a = points[l.de]?.nom_point ?? l.de;
  const b = points[l.a]?.nom_point ?? l.a;
  return `<div class="rg-popup"><strong>${echapper(a)} → ${echapper(b)}</strong>
    <table>
      <tr><th>Distance</th><td>${nombreFr(l.distance_km)} km</td></tr>
      <tr><th>Gisement</th><td>${nombreFr(l.azimut_deg, 2)}°</td></tr>
      <tr><th>Dans une boucle</th><td>${l.en_boucle ? 'Oui' : 'Non (N4)'}</td></tr>
      <tr><th>Longueur</th><td>${l.trop_longue ? 'Trop longue (N7)' : 'Conforme'}</td></tr>
    </table></div>`;
}

export function popupTriangle(t: TriangleResultat, points: PointResultat[]): string {
  const lignes = t.sommets.map((s, k) =>
    `<tr><th>${echapper(points[s]?.nom_point ?? s)}</th><td>${nombreFr(t.angles_deg[k], 2)}°</td></tr>`).join('');
  const etat = t.defectueux ? 'Défectueux (N1b)' : t.conforme ? 'Conforme (N1)' : 'Hors [30° ; 120°] (N1)';
  return `<div class="rg-popup"><strong>Triangle</strong> <em>${etat}</em><table>${lignes}</table></div>`;
}

/**
 * Carte Leaflet du réseau : fond (intégré ou personnel), triangles, lignes de base
 * (distance en km en info-bulle et en étiquette), points (popup LPA), emplacements suggérés
 * avec leur cercle de recherche.
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

  @ViewChild('conteneur', { static: true }) conteneur!: ElementRef<HTMLDivElement>;

  carte: L.Map | null = null;
  coucheFond: L.TileLayer | null = null;
  coucheReseau: L.LayerGroup | null = null;
  private observateur: ResizeObserver | null = null;
  private dejaCadre = false;

  ngAfterViewInit(): void {
    this.carte = L.map(this.conteneur.nativeElement, { zoomControl: true, attributionControl: true })
      .setView([31.8, -7.1], 6);
    L.control.scale({ imperial: false }).addTo(this.carte);
    this.coucheReseau = L.layerGroup().addTo(this.carte);
    this.appliquerFond();
    this.dessiner();
    if (typeof ResizeObserver !== 'undefined') {
      this.observateur = new ResizeObserver(() => this.carte?.invalidateSize());
      this.observateur.observe(this.conteneur.nativeElement);
    }
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.carte) return;
    if (ch['fond']) this.appliquerFond();
    if (ch['vue'] || ch['etiquettesDistances'] || ch['afficherTriangles']) {
      if (ch['vue']) this.dejaCadre = false;
      this.dessiner();
    }
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
    const options = { attribution: f.attribution || '', maxZoom: f.maxZoom || 20 };
    this.coucheFond = f.type === 'wms'
      ? L.tileLayer.wms(f.url, {
          ...options, layers: f.couches || '', format: f.format || 'image/png', transparent: false,
        })
      : L.tileLayer(f.url, options);
    this.coucheFond.addTo(this.carte);
    this.coucheFond.bringToBack();
  }

  /** (Re)dessine le réseau ; recadre sur les points quand la vue change. */
  dessiner(): void {
    if (!this.carte || !this.coucheReseau) return;
    this.coucheReseau.clearLayers();
    const v = this.vue;
    if (!v || !v.points.length) return;
    const pos = (i: number): L.LatLngExpression => [v.points[i].lat, v.points[i].lon];

    if (this.afficherTriangles) {
      v.triangles.forEach(t => {
        const couleur = t.defectueux ? COULEURS.triangleDefectueux
          : t.conforme ? COULEURS.triangleConforme : COULEURS.triangleNonConforme;
        L.polygon(t.sommets.map(pos), { stroke: false, fillColor: couleur, fillOpacity: 0.12 })
          .bindPopup(popupTriangle(t, v.points))
          .addTo(this.coucheReseau!);
      });
    }

    v.lignes.forEach(l => {
      const couleur = l.trop_longue ? COULEURS.ligneTropLongue
        : l.en_boucle ? COULEURS.ligne : COULEURS.ligneHorsBoucle;
      const suggeree = v.points[l.de]?.statut === 'suggere' || v.points[l.a]?.statut === 'suggere';
      const trait = L.polyline([pos(l.de), pos(l.a)], {
        color: couleur, weight: 2.5, opacity: 0.9, dashArray: suggeree ? '6 6' : undefined,
      });
      trait.bindPopup(popupLigne(l, v.points));
      trait.bindTooltip(`${nombreFr(l.distance_km)} km`, {
        permanent: this.etiquettesDistances, direction: 'center', className: 'rg-etiquette',
      });
      trait.addTo(this.coucheReseau!);
    });

    (v.suggestions || []).forEach(s => {
      L.circle([s.lat, s.lon], {
        radius: s.rayon_recherche_m, color: COULEURS.suggere, weight: 1.5, dashArray: '4 4',
        fillColor: COULEURS.suggere, fillOpacity: 0.12,
      }).bindPopup(`<div class="rg-popup"><strong>${echapper(s.nom_point)}</strong> <em>Zone de recherche</em>
          <p>${echapper(s.justification)}</p></div>`).addTo(this.coucheReseau!);
    });

    v.points.forEach(p => {
      const statut = p.statut || 'ancien';
      L.circleMarker([p.lat, p.lon], {
        radius: statut === 'suggere' ? 7 : 6, weight: 2, color: '#ffffff',
        fillColor: COULEURS[statut as 'ancien' | 'nouveau' | 'suggere'] || COULEURS.ancien, fillOpacity: 1,
      })
        .bindPopup(popupPoint(p))
        .bindTooltip(echapper(p.nom_point), { permanent: true, direction: 'top', offset: [0, -6], className: 'rg-nom' })
        .addTo(this.coucheReseau!);
    });

    if (!this.dejaCadre) {
      const limites = L.latLngBounds(v.points.map(p => [p.lat, p.lon] as L.LatLngTuple));
      this.carte.fitBounds(limites.pad(0.15), { maxZoom: 17 });
      this.dejaCadre = true;
    }
  }

  recadrer(): void {
    this.dejaCadre = false;
    this.dessiner();
  }
}
