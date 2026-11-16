import { Component, OnInit } from '@angular/core';
import { EtatMfa, SecuriteService, SessionCompte, appareil } from '../../../core/services/securite.service';
import { ToastService } from '../../../core/services/toast.service';

type ModeMfa = 'repos' | 'activation' | 'codes' | 'desactivation' | 'regeneration';

/**
 * Paramètres › Sécurité : double authentification (TOTP) et sessions ouvertes.
 * Les codes de secours ne sont montrés qu'une fois, juste après leur création.
 */
@Component({
  selector: 'app-securite-settings',
  templateUrl: './securite-settings.component.html',
  styleUrls: ['./securite-settings.component.scss'],
})
export class SecuriteSettingsComponent implements OnInit {
  mfa: EtatMfa | null = null;
  mode: ModeMfa = 'repos';
  secret = '';
  uri = '';
  code = '';
  motDePasse = '';
  codesSecours: string[] = [];
  sessions: SessionCompte[] = [];
  envoi = false;
  erreur = '';

  constructor(private service: SecuriteService, private toast: ToastService) {}

  ngOnInit(): void {
    this.service.etatMfa().subscribe({ next: e => (this.mfa = e), error: () => (this.erreur = 'Chargement impossible.') });
    this.chargerSessions();
  }

  chargerSessions(): void { this.service.sessions().subscribe({ next: s => (this.sessions = s), error: () => {} }); }

  private reinit(): void { this.code = ''; this.motDePasse = ''; this.erreur = ''; this.envoi = false; }

  commencer(): void {
    this.reinit(); this.envoi = true;
    this.service.initierMfa().subscribe({
      next: r => { this.secret = r.secret; this.uri = r.uri; this.mode = 'activation'; this.envoi = false; },
      error: e => { this.envoi = false; this.erreur = e?.error?.detail || 'Impossible de générer une clé.'; },
    });
  }

  activer(): void {
    if (!this.code.trim()) return;
    this.envoi = true; this.erreur = '';
    this.service.activerMfa(this.code.trim()).subscribe({
      next: e => { this.mfa = e; this.codesSecours = e.codes_secours || []; this.mode = 'codes'; this.reinit(); },
      error: e => { this.envoi = false; this.erreur = e?.error?.detail || 'Code incorrect.'; },
    });
  }

  desactiver(): void {
    if (!this.code.trim() || !this.motDePasse) return;
    this.envoi = true; this.erreur = '';
    this.service.desactiverMfa(this.motDePasse, this.code.trim()).subscribe({
      next: e => { this.mfa = e; this.mode = 'repos'; this.reinit(); this.toast.success('Sécurité', 'Double authentification désactivée.'); },
      error: e => { this.envoi = false; this.erreur = e?.error?.detail || 'Désactivation impossible.'; },
    });
  }

  regenerer(): void {
    if (!this.code.trim()) return;
    this.envoi = true; this.erreur = '';
    this.service.regenererCodes(this.code.trim()).subscribe({
      next: e => { this.mfa = e; this.codesSecours = e.codes_secours || []; this.mode = 'codes'; this.reinit(); },
      error: e => { this.envoi = false; this.erreur = e?.error?.detail || 'Code incorrect.'; },
    });
  }

  annuler(): void { this.mode = 'repos'; this.reinit(); this.secret = ''; this.uri = ''; }

  terminerCodes(): void { this.codesSecours = []; this.mode = 'repos'; }

  copierCodes(): void {
    navigator.clipboard?.writeText(this.codesSecours.join('\n')).then(
      () => this.toast.success('Codes de secours', 'Copiés dans le presse-papiers.'), () => {});
  }

  telechargerCodes(): void {
    const texte = `Codes de secours SDGPS — chacun ne sert qu'une fois.\n\n${this.codesSecours.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'sdgps-codes-de-secours.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  revoquer(s: SessionCompte): void {
    this.service.revoquer(s.id).subscribe(() => { this.sessions = this.sessions.filter(x => x.id !== s.id); });
  }

  revoquerAutres(): void {
    this.service.revoquerAutres().subscribe(r => {
      this.sessions = this.sessions.filter(s => s.courante);
      this.toast.success('Sessions', `${r.revoquees} session(s) fermée(s).`);
    });
  }

  get autres(): number { return this.sessions.filter(s => !s.courante).length; }
  appareil(s: SessionCompte): string { return appareil(s.agent); }
}
