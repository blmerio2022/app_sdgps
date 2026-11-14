import { Component } from '@angular/core';
import { ReseauGpsService, SourceLpa } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { lireFichierPoints } from '../points-import.util';
import { PointAncien, ReseauGpsStore } from '../reseau-gps.store';

/** Onglet 1 — rassembler les points anciens disponibles dans la zone. */
@Component({
  selector: 'app-onglet-points',
  templateUrl: './onglet-points.component.html',
  styleUrls: ['./onglet.scss'],
})
export class OngletPointsComponent {
  source: 'import' | 'lpa' | 'saisie' = 'import';
  sourcesLpa: SourceLpa[] = [];
  sourcesChargees = false;
  ssdgpsChoisi = '';
  importEnCours = false;

  constructor(public store: ReseauGpsStore, private service: ReseauGpsService, private toast: ToastService) {}

  choisirSource(s: 'import' | 'lpa' | 'saisie'): void {
    this.source = s;
    if (s === 'lpa' && !this.sourcesChargees) {
      this.service.sourcesLpa().subscribe({
        next: l => { this.sourcesLpa = l; this.sourcesChargees = true; },
        error: () => this.toast.error('Réseau GPS', 'Liste des LPA indisponible.'),
      });
    }
  }

  async importer(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier) return;
    this.importEnCours = true;
    try {
      const pts = await lireFichierPoints(fichier);
      if (!pts.length) {
        this.toast.error('Réseau GPS', 'Aucun point exploitable (colonnes X(m) et Y(m) attendues).');
      } else {
        this.store.definirAnciens(pts, fichier.name);
        this.toast.success('Réseau GPS', `${pts.length} point(s) ancien(s) importé(s).`);
      }
    } catch {
      this.toast.error('Réseau GPS', 'Lecture du fichier impossible.');
    } finally {
      this.importEnCours = false;
      input.value = '';
    }
  }

  chargerLpa(): void {
    if (!this.ssdgpsChoisi) return;
    this.service.sourceLpa(this.ssdgpsChoisi).subscribe({
      next: d => {
        if (d.zone_proposee) this.store.zone = d.zone_proposee;
        this.store.definirAnciens(d.points, d.libelle);
        this.toast.success('Réseau GPS', `${d.points.length} point(s) repris de la LPA.`);
      },
      error: () => this.toast.error('Réseau GPS', 'Reprise de la LPA impossible.'),
    });
  }

  basculer(a: PointAncien): void { this.store.basculerRetenu(a); }
  trackIndex(i: number): number { return i; }
}
