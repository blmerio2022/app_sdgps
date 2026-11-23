import { Component } from '@angular/core';
import { TypeZone } from '../../../core/services/reseau-gps.service';
import { formatAire, formatDistance } from '../mesures.util';
import { COULEURS_ZONES, LIBELLES_ZONES, ReseauGpsStore, ZoneReseau } from '../reseau-gps.store';

/** Extensions acceptées à l'import (shapefile éclaté, archive, GeoPackage). */
export const EXTENSIONS_ZONES = '.zip,.shp,.dbf,.shx,.prj,.cpg,.gpkg';

/**
 * Onglet « Zones » : zones LEVÉES (lever de détail à couvrir, norme N11) et zones de
 * DENSIFICATION (où placer les points nouveaux), importées d'un shapefile / GeoPackage ou
 * dessinées sur la carte. Chacune porte un nom, un type, une référence, une description et
 * une couleur ; sa surface et son périmètre sont calculés dans le plan Lambert.
 */
@Component({
  selector: 'app-onglet-zones',
  templateUrl: './onglet-zones.component.html',
  styleUrls: ['./onglet.scss', './onglet-zones.component.scss'],
})
export class OngletZonesComponent {
  readonly extensions = EXTENSIONS_ZONES;
  readonly libelles = LIBELLES_ZONES;
  readonly couleurs = COULEURS_ZONES;
  readonly types: TypeZone[] = ['levee', 'densification'];
  readonly aire = formatAire;
  readonly distance = formatDistance;
  typeDefautImport: TypeZone | '' = '';
  attributsOuverts: Record<string, boolean> = {};

  constructor(public store: ReseauGpsStore) {}

  importer(event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichiers = Array.from(input.files || []);
    input.value = '';
    this.store.importerZones(fichiers, this.typeDefautImport || null);
  }

  basculerDessin(type?: TypeZone): void {
    if (this.store.modeDessinZone) { this.store.modeDessinZone = false; return; }
    if (type) this.store.typeDessin = type;
    this.store.commencerDessinZone();
  }

  nombre(type: TypeZone): number { return this.store.zones.filter(z => z.type === type).length; }

  surfaceTotale(type: TypeZone): number {
    return this.store.zonesActives(type).reduce((s, z) => s + this.store.mesuresZone(z).aire, 0);
  }

  attributs(z: ZoneReseau): [string, string][] { return Object.entries(z.attributs || {}); }

  exporter(): void {
    const blob = new Blob([this.store.exporterGeoJson()], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zones-reseau-gnss.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  supprimer(z: ZoneReseau): void {
    if (window.confirm(`Supprimer la zone « ${z.nom} » ?`)) this.store.supprimerZone(z.id);
  }

  vider(): void {
    if (window.confirm(`Supprimer les ${this.store.zones.length} zones ?`)) this.store.viderZones();
  }

  trackId(_: number, z: ZoneReseau): string { return z.id; }
}
