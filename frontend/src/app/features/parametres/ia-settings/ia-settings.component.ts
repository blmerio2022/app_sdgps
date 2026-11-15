import { Component, OnInit } from '@angular/core';
import { IaConfiguration, IaConfigurationSaisie, IaFournisseur, IaResultatTest } from '../../../core/models/ia.model';
import { IaService, messageErreurIa } from '../../../core/services/ia.service';

/**
 * Paramètres › Intelligence artificielle.
 *
 * - Tous : état effectif (fournisseur, modèles, clé présente ?) et choix PERSONNEL du
 *   modèle de son assistant.
 * - Administration de l'application : fournisseur, clé d'API (chiffrée côté serveur,
 *   jamais relue), modèle par défaut, modèles de secours, adresse / protocole / délai,
 *   test de connexion, retour à la configuration du serveur. Fonctionne à l'identique
 *   en local (OmniRoute…) comme en ligne (OpenRouter, Gemini…).
 */
@Component({
  selector: 'app-ia-settings',
  templateUrl: './ia-settings.component.html',
  styleUrls: ['./ia-settings.component.scss'],
})
export class IaSettingsComponent implements OnInit {
  config: IaConfiguration | null = null;
  chargement = true;
  erreur = '';
  succes = '';

  // Formulaire (administration)
  actif: boolean | null = null;
  fournisseur = '';
  baseUrl = '';
  protocole = '';
  modele = '';
  secours: string[] = [];
  nouveauSecours = '';
  delai: number | null = null;
  cle = '';
  afficherCle = false;
  effacerCle = false;
  avance = false;
  enregistrement = false;

  // Modèles disponibles
  modeles: string[] = [];
  filtreModeles = '';
  chargementModeles = false;
  erreurModeles = '';

  // Test de connexion
  test: IaResultatTest | null = null;
  testEnCours = false;

  // Préférence personnelle
  modelePrefere = '';
  modeleParDefaut = '';
  enregistrementPref = false;
  prefEnregistree = false;

  constructor(private ia: IaService) {}

  ngOnInit(): void {
    this.charger();
    this.ia.preferences().subscribe({
      next: p => { this.modelePrefere = p.modele_assistant; this.modeleParDefaut = p.modele_par_defaut; },
      error: () => {},
    });
  }

  get fournisseurChoisi(): IaFournisseur | undefined {
    return this.config?.catalogue.find(f => f.cle === this.fournisseur);
  }

  get modelesFiltres(): string[] {
    const f = this.filtreModeles.trim().toLowerCase();
    return (f ? this.modeles.filter(m => m.toLowerCase().includes(f)) : this.modeles).slice(0, 300);
  }

  charger(): void {
    this.chargement = true;
    this.ia.configuration().subscribe({
      next: c => { this.appliquer(c); this.chargement = false; },
      error: err => { this.erreur = messageErreurIa(err); this.chargement = false; },
    });
  }

  private appliquer(c: IaConfiguration): void {
    this.config = c;
    const s = c.saisie;
    this.actif = s.actif;
    this.fournisseur = s.fournisseur;
    this.baseUrl = s.base_url;
    this.protocole = s.protocole;
    this.modele = s.modele;
    this.secours = [...s.modeles_secours];
    this.delai = s.delai;
    this.cle = '';
    this.effacerCle = false;
    this.avance = !!(s.base_url || s.protocole || s.delai);
  }

  choisirFournisseur(cle: string): void {
    if (this.fournisseur === cle) return;
    this.fournisseur = cle;
    // Un modèle d'un autre fournisseur n'a aucun sens ici : on repart du modèle suggéré.
    this.modele = '';
    this.secours = [];
    this.modeles = [];
  }

  ajouterSecours(valeur = this.nouveauSecours): void {
    const m = (valeur || '').trim();
    if (m && !this.secours.includes(m) && this.secours.length < 10) this.secours = [...this.secours, m];
    this.nouveauSecours = '';
  }

  retirerSecours(i: number): void { this.secours = this.secours.filter((_, j) => j !== i); }

  monterSecours(i: number): void {
    if (i <= 0) return;
    const l = [...this.secours];
    [l[i - 1], l[i]] = [l[i], l[i - 1]];
    this.secours = l;
  }

  enregistrer(): void {
    if (this.enregistrement) return;
    this.enregistrement = true;
    this.erreur = '';
    this.succes = '';
    const saisie: IaConfigurationSaisie = {
      actif: this.actif, fournisseur: this.fournisseur, base_url: this.baseUrl.trim(),
      protocole: this.protocole, modele: this.modele.trim(), modeles_secours: this.secours,
      delai: this.delai || null,
    };
    if (this.effacerCle) saisie.effacer_cle = true;
    else if (this.cle.trim()) saisie.cle = this.cle.trim();
    this.ia.enregistrerConfiguration(saisie).subscribe({
      next: c => {
        this.appliquer(c);
        this.enregistrement = false;
        this.test = null;
        this.succes = 'Configuration enregistrée.';
      },
      error: err => {
        this.enregistrement = false;
        const champs = err?.error && typeof err.error === 'object' && !err.error.detail
          ? Object.values(err.error).join(' ') : '';
        this.erreur = champs || messageErreurIa(err);
      },
    });
  }

  reinitialiser(): void {
    if (!confirm('Revenir à la configuration du serveur ? La configuration saisie ici, '
      + 'clé comprise, sera effacée.')) return;
    this.ia.reinitialiserConfiguration().subscribe({
      next: c => { this.appliquer(c); this.succes = 'Configuration du serveur rétablie.'; this.test = null; },
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  tester(): void {
    this.testEnCours = true;
    this.test = null;
    this.ia.testerConfiguration().subscribe({
      next: r => { this.test = r; this.testEnCours = false; },
      error: err => { this.test = { ok: false, essais: [], erreur: messageErreurIa(err) }; this.testEnCours = false; },
    });
  }

  chargerModeles(): void {
    this.chargementModeles = true;
    this.erreurModeles = '';
    this.ia.modeles().subscribe({
      next: r => {
        this.modeles = r.modeles || [];
        this.erreurModeles = r.erreur || (this.modeles.length ? '' : 'Aucun modèle renvoyé par le fournisseur.');
        this.chargementModeles = false;
      },
      error: err => { this.erreurModeles = messageErreurIa(err); this.chargementModeles = false; },
    });
  }

  enregistrerPreference(): void {
    this.enregistrementPref = true;
    this.ia.enregistrerPreferences(this.modelePrefere.trim()).subscribe({
      next: p => {
        this.modelePrefere = p.modele_assistant;
        this.enregistrementPref = false;
        this.prefEnregistree = true;
        setTimeout(() => (this.prefEnregistree = false), 2500);
      },
      error: err => { this.enregistrementPref = false; this.erreur = messageErreurIa(err); },
    });
  }
}
