import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Code renvoyé par le serveur quand un envoi est refusé pour quota de stockage dépassé. */
export const CODE_QUOTA_DEPASSE = 'QUOTA_DEPASSE';

/** Préfixe du message serveur (sert à reconnaître le refus quand seul le texte est transmis). */
export const PREFIXE_QUOTA = 'Quota de stockage dépassé';

/** Chiffres joints par le serveur à un refus de quota. */
export interface RefusQuota {
  organization_name: string;
  quota_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
  incoming_bytes: number;
}

/** État du quota d'une organisation (même forme que l'écran super admin). */
export interface EtatQuota {
  organization_id: string;
  organization_name: string;
  quota_bytes: number | null;
  effective_quota_bytes: number;
  used_bytes: number;
  remaining_bytes: number | null;
  usage_percent: number | null;
  is_unlimited: boolean;
  is_exceeded: boolean;
}

export interface MonStockage {
  /** null : l'utilisateur n'appartient à aucune organisation (rien ne lui est imputé). */
  organisation: EtatQuota | null;
  ma_part_bytes: number;
  mes_projets: { id: string; code: string; nom: string; bytes: number }[];
}

/** L'erreur HTTP est-elle un refus pour quota de stockage dépassé ? */
export function estRefusQuota(err: any): boolean {
  const corps = err?.error ?? err;
  if (corps?.code === CODE_QUOTA_DEPASSE) return true;
  const detail = corps?.detail;
  return typeof detail === 'string' && detail.startsWith(PREFIXE_QUOTA);
}

/** Chiffres du refus de quota (null si l'erreur n'en est pas un ou n'en porte pas). */
export function refusQuota(err: any): RefusQuota | null {
  const corps = err?.error ?? err;
  return corps?.code === CODE_QUOTA_DEPASSE && corps?.quota ? corps.quota as RefusQuota : null;
}

/** Message complet d'un refus de quota, tel que rédigé par le serveur. */
export function messageRefusQuota(err: any): string {
  const corps = err?.error ?? err;
  return typeof corps?.detail === 'string' ? corps.detail
    : `${PREFIXE_QUOTA} : l'envoi est refusé, rien n'a été enregistré.`;
}

/** Taille lisible en unités françaises (« 1,5 Go »). */
export function octetsLisibles(valeur: number | null | undefined): string {
  let v = Number(valeur || 0);
  if (v < 1024) return `${Math.round(v)} octets`;
  for (const unite of ['Ko', 'Mo', 'Go', 'To']) {
    v /= 1024;
    if (v < 1024 || unite === 'To') return `${v.toFixed(1).replace('.0', '').replace('.', ',')} ${unite}`;
  }
  return `${v} To`;
}

/** Espace de stockage de l'organisation de l'utilisateur connecté. */
@Injectable({ providedIn: 'root' })
export class StockageService {
  private readonly url = `${environment.apiUrl}/v1/analytics/mon-stockage/`;

  constructor(private http: HttpClient) {}

  monStockage(): Observable<MonStockage> {
    return this.http.get<MonStockage>(this.url);
  }
}
