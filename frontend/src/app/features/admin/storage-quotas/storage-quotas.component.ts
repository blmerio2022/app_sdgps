import { Component, OnInit } from '@angular/core';
import {
  OrganizationQuota, StorageQuotaService,
  bytesToGibibytes, gibibytesToBytes, humanBytes,
} from '../../../core/services/storage-quota.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Écran SUPER ADMIN de configuration des quotas de stockage par organisation
 * (route `/admin/quotas/limites`).
 *
 * Chaque ligne montre la consommation réelle de l'organisation et permet de fixer son
 * plafond. La saisie se fait en **Go** (unité parlante pour un arbitrage) et est
 * convertie en octets pour l'API, qui est la seule unité de référence côté serveur.
 */
@Component({
  selector: 'app-storage-quotas',
  templateUrl: './storage-quotas.component.html',
  styleUrls: ['./storage-quotas.component.scss'],
})
export class StorageQuotasComponent implements OnInit {
  quotas: OrganizationQuota[] = [];
  defaultQuotaBytes = 0;
  loading = false;
  error = '';

  /** Saisie en cours par organisation (Go) — `null` = « défaut global ». */
  draft: Record<string, number | null> = {};
  /** Organisations dont l'enregistrement est en cours (désactive la ligne). */
  saving: Record<string, boolean> = {};

  readonly humanBytes = humanBytes;

  constructor(
    private quotaService: StorageQuotaService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.quotaService.list().subscribe({
      next: (res) => {
        this.defaultQuotaBytes = res.default_quota_bytes;
        this.quotas = res.results;
        this.draft = {};
        for (const q of res.results) {
          this.draft[q.organization_id] = bytesToGibibytes(q.quota_bytes);
        }
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.detail
          || 'Impossible de charger les quotas (réservé au super administrateur).';
      },
    });
  }

  /** Enregistre le plafond saisi pour une organisation. */
  save(quota: OrganizationQuota): void {
    const id = quota.organization_id;
    if (this.saving[id]) return;

    const go = this.draft[id];
    const bytes = go === null || (go as any) === '' ? null : gibibytesToBytes(Number(go));
    if (bytes !== null && bytes < 0) {
      this.toast.error('Quota', 'Le quota ne peut pas être négatif.');
      return;
    }

    this.saving[id] = true;
    this.quotaService.setQuota(id, bytes).subscribe({
      next: (updated) => {
        this.saving[id] = false;
        const i = this.quotas.findIndex(q => q.organization_id === id);
        if (i >= 0) this.quotas[i] = updated;
        this.draft[id] = bytesToGibibytes(updated.quota_bytes);
        this.toast.success('Quota', `Plafond de « ${updated.organization_name} » enregistré.`);
      },
      error: (err) => {
        this.saving[id] = false;
        this.toast.error('Quota', err?.error?.detail || "Échec de l'enregistrement du quota.");
      },
    });
  }

  /** Repasse l'organisation au défaut global (quota non arbitré). */
  resetToDefault(quota: OrganizationQuota): void {
    this.draft[quota.organization_id] = null;
    this.save(quota);
  }

  /** Libellé du plafond appliqué, états « illimité » et « défaut » compris. */
  quotaLabel(q: OrganizationQuota): string {
    if (q.is_unlimited) return 'Illimité';
    return humanBytes(q.effective_quota_bytes);
  }

  /** Part consommée, bornée à 100 % pour la barre de progression. */
  usageWidth(q: OrganizationQuota): number {
    if (q.is_unlimited || !q.usage_percent) return 0;
    return Math.min(100, q.usage_percent);
  }

  /** Classe de couleur de la barre : vert, orange dès 75 %, rouge au dépassement. */
  usageClass(q: OrganizationQuota): string {
    if (q.is_unlimited) return 'is-unlimited';
    if (q.is_exceeded) return 'is-exceeded';
    return (q.usage_percent || 0) >= 75 ? 'is-warning' : 'is-ok';
  }

  trackById(_i: number, q: OrganizationQuota): string {
    return q.organization_id;
  }
}
