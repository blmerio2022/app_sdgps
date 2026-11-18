import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import {
  COULEURS_STATUT, CarteDossiers, CarteDossiersService, DossierCarte,
} from '../../core/services/carte-dossiers.service';

const FONDS = {
  plan: {
    nom: 'Plan', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
    attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    nom: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19, attribution: 'Tuiles &copy; Esri',
  },
};
export type CleFond = keyof typeof FONDS;

export const STATUTS = [
  { cle: 'en_cours', libelle: 'En cours' }, { cle: 'soumis', libelle: 'Soumis' },
  { cle: 'valide', libelle: 'Validé' }, { cle: 'clos', libelle: 'Clos' },
];

/** Échappe un texte inséré dans le HTML d'une infobulle Leaflet. */
export function echapper(t: string): string {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Carte des dossiers — chaque SDGPS visible, placé au centre de ses points anciens et coloré
 * selon son statut ; clic → infobulle avec lien vers le dossier. Filtres par statut et par
 * texte ; recadrage sur les dossiers affichés.
 */
@Component({
  selector: 'app-carte-dossiers-page',
  templateUrl: './carte-dossiers-page.component.html',
  styleUrls: ['./carte-dossiers-page.component.scss'],
})
export class CarteDossiersPageComponent implements OnInit, OnDestroy {
  @ViewChild('carte', { static: true }) carteRef!: ElementRef<HTMLDivElement>;

  readonly statuts = STATUTS;
  readonly couleurs = COULEURS_STATUT;
  donnees: CarteDossiers | null = null;
  chargement = true;
  erreur = '';
  statutsActifs = new Set(STATUTS.map(s => s.cle));
  recherche = '';
  fond: CleFond = 'plan';

  private carte: L.Map | null = null;
  private coucheFond: L.TileLayer | null = null;
  private coucheDossiers = L.layerGroup();

  constructor(private service: CarteDossiersService, private router: Router) {}

  /** Conteneur `static` : disponible dès `ngOnInit` (charger après la vue modifierait
   * l'affichage déjà vérifié — NG0100). */
  ngOnInit(): void {
    this.carte = L.map(this.carteRef.nativeElement, { zoomControl: true, attributionControl: true })
      .setView([31.8, -7.1], 6);                     // Maroc
    this.coucheDossiers.addTo(this.carte);
    this.appliquerFond();
    this.charger();
    // Le conteneur prend sa taille après le premier rendu : Leaflet doit la relire.
    setTimeout(() => this.carte?.invalidateSize(), 0);
  }

  ngOnDestroy(): void { this.carte?.remove(); this.carte = null; }

  charger(): void {
    this.chargement = true;
    this.erreur = '';
    this.service.charger().subscribe({
      next: d => { this.donnees = d; this.chargement = false; this.dessiner(true); },
      error: e => { this.chargement = false; this.erreur = e?.error?.detail || 'Chargement de la carte impossible.'; },
    });
  }

  get visibles(): DossierCarte[] {
    const q = this.recherche.trim().toLowerCase();
    return (this.donnees?.dossiers || []).filter(d => this.statutsActifs.has(d.statut)
      && (!q || `${d.titre} ${d.contexte}`.toLowerCase().includes(q)));
  }
  compte(statut: string): number { return (this.donnees?.dossiers || []).filter(d => d.statut === statut).length; }

  basculerStatut(cle: string): void {
    this.statutsActifs.has(cle) ? this.statutsActifs.delete(cle) : this.statutsActifs.add(cle);
    this.dessiner(false);
  }
  filtrer(): void { this.dessiner(false); }
  changerFond(f: CleFond): void { this.fond = f; this.appliquerFond(); }

  private appliquerFond(): void {
    if (!this.carte) return;
    if (this.coucheFond) this.carte.removeLayer(this.coucheFond);
    const f = FONDS[this.fond];
    this.coucheFond = L.tileLayer(f.url, { attribution: f.attribution, maxZoom: 20, maxNativeZoom: f.maxZoom });
    this.coucheFond.addTo(this.carte);
    this.coucheFond.bringToBack();
  }

  /** (Re)dessine les dossiers ; `recadrer` : ajuste la vue sur l'ensemble affiché. */
  dessiner(recadrer: boolean): void {
    if (!this.carte) return;
    this.coucheDossiers.clearLayers();
    const prefixe = this.router.url.startsWith('/admin') ? '/admin/' : '/';
    for (const d of this.visibles) {
      const couleur = COULEURS_STATUT[d.statut] || '#cc5858';
      const marqueur = L.circleMarker([d.lat, d.lon], {
        radius: 8, color: '#fff', weight: 2, fillColor: couleur, fillOpacity: 0.95,
      });
      marqueur.bindTooltip(echapper(d.titre), { direction: 'top', offset: [0, -6] });
      marqueur.bindPopup(
        `<div class="cd-popup"><strong>${echapper(d.titre)}</strong>`
        + `<span>${echapper(d.contexte)}</span>`
        + `<span class="cd-statut" style="color:${couleur}">● ${echapper(d.statut_display)}</span>`
        + `<span class="cd-meta">${d.nb_points} point(s) ${echapper(d.source)}`
        + `${d.zone_supposee ? ' · zone Lambert supposée' : ''}</span>`
        + `<a href="${prefixe}${echapper(d.lien)}" data-lien="${echapper(d.lien)}">Ouvrir le dossier →</a></div>`);
      marqueur.on('popupopen', (ev: any) => {
        const a: HTMLAnchorElement | null = ev.popup.getElement()?.querySelector('a[data-lien]');
        a?.addEventListener('click', (clic: Event) => { clic.preventDefault(); this.ouvrir(d); });
      });
      marqueur.addTo(this.coucheDossiers);
    }
    if (recadrer && this.visibles.length) {
      const limites = L.latLngBounds(this.visibles.map(d => [d.lat, d.lon] as [number, number]));
      this.carte.fitBounds(limites.pad(0.25), { maxZoom: 13 });
    }
  }

  ouvrir(d: DossierCarte): void {
    const prefixe = this.router.url.startsWith('/admin') ? '/admin/' : '/';
    this.router.navigateByUrl(prefixe + d.lien);
  }

  centrerSur(d: DossierCarte): void { this.carte?.setView([d.lat, d.lon], 14); }
}
