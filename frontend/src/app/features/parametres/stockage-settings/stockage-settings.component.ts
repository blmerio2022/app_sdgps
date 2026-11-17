import { Component, OnInit } from '@angular/core';
import { EtatQuota, MonStockage, StockageService, octetsLisibles } from '../../../core/services/stockage.service';

/** Niveau d'occupation : sert à la couleur de la jauge et au message. */
export type NiveauStockage = 'illimite' | 'ok' | 'attention' | 'critique' | 'plein';

export function niveauStockage(q: EtatQuota | null | undefined): NiveauStockage {
  if (!q || q.is_unlimited) return 'illimite';
  if (q.is_exceeded) return 'plein';
  const p = q.usage_percent ?? 0;
  return p >= 90 ? 'critique' : p >= 75 ? 'attention' : 'ok';
}

/**
 * Paramètres › Espace de stockage — l'opérateur voit le quota de SON organisation
 * (celle à qui sont imputés ses projets), ce qui est utilisé, ce qui reste, sa part et ses
 * projets les plus lourds : de quoi savoir AVANT d'importer s'il reste de la place, et où
 * en libérer sinon.
 */
@Component({
  selector: 'app-stockage-settings',
  templateUrl: './stockage-settings.component.html',
  styleUrls: ['./stockage-settings.component.scss'],
})
export class StockageSettingsComponent implements OnInit {
  donnees: MonStockage | null = null;
  chargement = false;
  erreur = '';
  readonly taille = octetsLisibles;

  constructor(private service: StockageService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true; this.erreur = '';
    this.service.monStockage().subscribe({
      next: d => { this.donnees = d; this.chargement = false; },
      error: e => { this.chargement = false; this.erreur = e?.error?.detail || 'Lecture de l’espace de stockage impossible.'; },
    });
  }

  get quota(): EtatQuota | null { return this.donnees?.organisation ?? null; }
  get niveau(): NiveauStockage { return niveauStockage(this.quota); }
  /** Largeur de la jauge (bornée à 100 % même au-delà du plafond). */
  get largeur(): number { return Math.min(100, Math.max(0, this.quota?.usage_percent ?? 0)); }
  /** Part de l'utilisateur dans la consommation de l'organisation (%). */
  get maPart(): number {
    const u = this.quota?.used_bytes || 0;
    return u ? Math.round(100 * (this.donnees?.ma_part_bytes || 0) / u) : 0;
  }
  /** Pourcentage au format français (« 94,3 % »). */
  pourcent(valeur: number | null | undefined): string {
    return `${(Math.round((valeur || 0) * 10) / 10).toString().replace('.', ',')} %`;
  }
  pourcentProjet(octets: number): number {
    const max = this.donnees?.mes_projets[0]?.bytes || 0;
    return max ? Math.max(2, Math.round(100 * octets / max)) : 0;
  }
}
