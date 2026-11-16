import { Component, Injectable, OnInit } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ToastService } from '../../../core/services/toast.service';

export interface Sauvegarde { nom: string; taille: number | null; date: string | null; avec_medias: boolean; securite: boolean; }
export interface EtatSauvegardes {
  sauvegardes: Sauvegarde[]; derniere: Sauvegarde | null; en_retard: boolean; alerte_heures: number;
  retention: number; environnement: string; super_admin: boolean;
}

@Injectable({ providedIn: 'root' })
export class SauvegardesService {
  private readonly base = `${environment.apiUrl}/v1/platform-admin/sauvegardes/`;
  constructor(private http: HttpClient) {}
  etat(): Observable<EtatSauvegardes> { return this.http.get<EtatSauvegardes>(this.base); }
  creer(avecMedias: boolean): Observable<any> { return this.http.post(this.base, { avec_medias: avecMedias }); }
  telecharger(nom: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}${encodeURIComponent(nom)}/`, { responseType: 'blob', observe: 'response' });
  }
  supprimer(nom: string): Observable<void> { return this.http.delete<void>(`${this.base}${encodeURIComponent(nom)}/`); }
  restaurer(nom: string, confirmation: string): Observable<any> {
    return this.http.post(`${this.base}${encodeURIComponent(nom)}/restaurer/`, { confirmation });
  }
}

export function taille(octets: number | null): string {
  if (octets === null || octets === undefined) return '—';
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Administration › Sauvegardes : état de la dernière sauvegarde, création à la demande
 * (base seule ou base + fichiers), téléchargement ; suppression et restauration réservées
 * au Super Admin, la restauration exigeant le nom exact de l'environnement.
 *
 * ⚠ Exception assumée aux règles de tableaux : liste de fichiers d'archive, pas d'entités.
 */
@Component({
  selector: 'app-sauvegardes',
  templateUrl: './sauvegardes.component.html',
  styleUrls: ['./sauvegardes.component.scss'],
})
export class SauvegardesComponent implements OnInit {
  etat: EtatSauvegardes | null = null;
  chargement = false;
  creation = false;
  avecMedias = false;
  erreur = '';
  aRestaurer: Sauvegarde | null = null;
  confirmation = '';
  restauration = false;

  constructor(private service: SauvegardesService, private toast: ToastService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true; this.erreur = '';
    this.service.etat().subscribe({
      next: e => { this.etat = e; this.chargement = false; },
      error: e => { this.chargement = false; this.erreur = e?.status === 403 ? 'Réservé à l’administration de l’application.' : 'Chargement impossible.'; },
    });
  }

  creer(): void {
    this.creation = true;
    this.service.creer(this.avecMedias).subscribe({
      next: r => { this.creation = false; this.toast.success('Sauvegarde', `${r.nom} créée (${r.objets} objets).`); this.charger(); },
      error: e => { this.creation = false; this.toast.error('Sauvegarde', e?.error?.detail || 'Création impossible.'); },
    });
  }

  telecharger(s: Sauvegarde): void {
    this.service.telecharger(s.nom).subscribe({
      next: rep => {
        const url = URL.createObjectURL(rep.body as Blob);
        const a = document.createElement('a');
        a.href = url; a.download = s.nom; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.toast.error('Sauvegarde', 'Téléchargement impossible.'),
    });
  }

  supprimer(s: Sauvegarde): void {
    if (!confirm(`Supprimer définitivement ${s.nom} ?`)) return;
    this.service.supprimer(s.nom).subscribe({
      next: () => this.charger(),
      error: e => this.toast.error('Sauvegarde', e?.error?.detail || 'Suppression impossible.'),
    });
  }

  demanderRestauration(s: Sauvegarde): void { this.aRestaurer = s; this.confirmation = ''; }

  get confirmationValide(): boolean { return !!this.etat && this.confirmation === this.etat.environnement; }

  restaurer(): void {
    if (!this.aRestaurer || !this.confirmationValide) return;
    this.restauration = true;
    this.service.restaurer(this.aRestaurer.nom, this.confirmation).subscribe({
      next: r => {
        this.restauration = false; this.aRestaurer = null;
        this.toast.success('Restauration', `Base restaurée. État précédent : ${r.sauvegarde_securite}. Reconnectez-vous.`);
        this.charger();
      },
      error: e => { this.restauration = false; this.toast.error('Restauration', e?.error?.detail || 'Restauration impossible.'); },
    });
  }

  taille(o: number | null): string { return taille(o); }
}
