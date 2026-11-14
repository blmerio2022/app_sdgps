import { Component } from '@angular/core';
import { ReseauGpsService, SourceRc } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { lireFichierRc } from '../points-import.util';
import { PointAncien, ReseauGpsStore } from '../reseau-gps.store';
import { fr } from './onglet-controle.component';

/**
 * Onglet 3 — après les observations de terrain du réseau de contrôle, import du rapport de
 * contrôle (RC), analyse des écarts ΔD contre la tolérance (15 cm par défaut, réglable) et
 * arrêt des points anciens homogènes (détection automatique, ajustable à la main).
 */
@Component({
  selector: 'app-onglet-ecarts',
  templateUrl: './onglet-ecarts.component.html',
  styleUrls: ['./onglet.scss'],
})
export class OngletEcartsComponent {
  source: 'import' | 'piece' = 'import';
  sourcesRc: SourceRc[] = [];
  sourcesChargees = false;
  ssdgpsChoisi = '';
  importEnCours = false;
  readonly fr = fr;

  constructor(public store: ReseauGpsStore, private service: ReseauGpsService, private toast: ToastService) {}

  choisirSource(s: 'import' | 'piece'): void {
    this.source = s;
    if (s === 'piece' && !this.sourcesChargees) {
      this.service.sourcesRc().subscribe({
        next: l => { this.sourcesRc = l; this.sourcesChargees = true; },
        error: () => this.toast.error('Réseau GPS', 'Liste des rapports de contrôle indisponible.'),
      });
    }
  }

  async importer(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier) return;
    this.importEnCours = true;
    try {
      const lignes = await lireFichierRc(fichier);
      if (!lignes.length) {
        this.toast.error('Réseau GPS', 'Aucune ligne exploitable (colonnes Nom Point Fixe / Nom Point Calculé attendues).');
      } else {
        this.store.definirRc(lignes, fichier.name);
        this.store.analyserEcarts();
      }
    } catch {
      this.toast.error('Réseau GPS', 'Lecture du fichier impossible.');
    } finally {
      this.importEnCours = false;
      input.value = '';
    }
  }

  chargerPiece(): void {
    if (!this.ssdgpsChoisi) return;
    this.service.sourceRc(this.ssdgpsChoisi).subscribe({
      next: d => { this.store.definirRc(d.lignes, d.libelle); this.store.analyserEcarts(); },
      error: () => this.toast.error('Réseau GPS', 'Reprise du rapport de contrôle impossible.'),
    });
  }

  /** Ligne d'analyse du point (null : point du réseau absent du RC). */
  analysePoint(nom: string) {
    return this.store.analyse?.points.find(p => p.nom_point === nom) || null;
  }

  basculer(a: PointAncien): void { this.store.basculerHomogene(a); }
}
