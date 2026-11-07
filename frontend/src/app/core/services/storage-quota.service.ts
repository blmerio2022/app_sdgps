import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * État du quota de stockage d'une organisation, tel que le renvoie
 * `backend/organizations/views.py::OrganizationStorageQuotaView`.
 *
 * Trois états distincts, à ne pas confondre :
 *  - `quota_bytes === null` → aucun arbitrage : le défaut global s'applique ;
 *  - `effective_quota_bytes === 0` → illimité ;
 *  - sinon → plafond en octets.
 */
export interface OrganizationQuota {
  organization_id: string;
  organization_name: string;
  /** Valeur BRUTE enregistrée (null = non arbitré). */
  quota_bytes: number | null;
  /** Plafond réellement appliqué (défaut global résolu). 0 = illimité. */
  effective_quota_bytes: number;
  used_bytes: number;
  remaining_bytes: number | null;
  usage_percent: number | null;
  is_unlimited: boolean;
  is_exceeded: boolean;
}

export interface OrganizationQuotaList {
  default_quota_bytes: number;
  results: OrganizationQuota[];
}

/**
 * Consultation et configuration des quotas de stockage par organisation.
 * Réservé au SUPER ADMIN : le backend renvoie 403 pour tout autre rôle.
 */
@Injectable({ providedIn: 'root' })
export class StorageQuotaService {
  private readonly base = `${environment.apiUrl}/v1/organizations`;

  constructor(private http: HttpClient) {}

  /** Quota et consommation de toutes les organisations. */
  list(): Observable<OrganizationQuotaList> {
    return this.http.get<OrganizationQuotaList>(`${this.base}/storage-quotas/`);
  }

  /**
   * Fixe le quota d'une organisation.
   * @param bytes `null` = revenir au défaut global, `0` = illimité, sinon le plafond.
   */
  setQuota(organizationId: string, bytes: number | null): Observable<OrganizationQuota> {
    return this.http.put<OrganizationQuota>(
      `${this.base}/${organizationId}/storage-quota/`, { storage_quota_bytes: bytes });
  }
}

/** Octets → libellé lisible (« 1,5 Go »). Miroir de `analytics.quotas.human_bytes`. */
export function humanBytes(value: number | null | undefined): string {
  let v = Number(value || 0);
  if (v < 1024) return `${Math.round(v)} octets`;
  for (const unit of ['Ko', 'Mo', 'Go', 'To']) {
    v /= 1024;
    if (v < 1024 || unit === 'To') {
      return `${v.toFixed(1).replace('.0', '').replace('.', ',')} ${unit}`;
    }
  }
  return `${v} To`;
}

/** Go (saisie de l'écran) → octets. `null` reste `null` (retour au défaut global). */
export function gibibytesToBytes(go: number | null): number | null {
  if (go === null || go === undefined || Number.isNaN(go)) return null;
  return Math.max(0, Math.round(go * 1024 * 1024 * 1024));
}

/** Octets → Go, pour pré-remplir le champ de saisie (2 décimales). */
export function bytesToGibibytes(bytes: number | null): number | null {
  if (bytes === null || bytes === undefined) return null;
  return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
}
