import { Component, OnInit } from '@angular/core';
import {
  GestionRessources, NiveauRessources, RessourceDisponible, RessourceTbc, RessourcesTbcService, TypeRessourceTbc,
  enregistrerBlob,
} from '../../../core/services/ressources-tbc.service';
import { octetsLisibles } from '../../../core/services/stockage.service';
import { ToastService } from '../../../core/services/toast.service';

export const TYPES_RESSOURCES: { type: TypeRessourceTbc; libelle: string; icone: string }[] = [
  { type: 'etude_modele', libelle: 'Étude modèle TBC', icone: 'fa-folder-tree' },
  { type: 'ruban', libelle: 'Personnalisation du ruban TBC', icone: 'fa-sliders' },
];

/**
 * Paramètres › Ressources TBC — l'opérateur télécharge l'étude modèle et le fichier de
 * personnalisation du ruban de TBC : ceux de son organisation, sinon ceux de l'application.
 * Les administrateurs (application, organisation) y déposent, remplacent ou retirent ces
 * fichiers pour chaque niveau qu'ils administrent.
 */
@Component({
  selector: 'app-ressources-tbc-settings',
  templateUrl: './ressources-tbc-settings.component.html',
  styleUrls: ['./ressources-tbc-settings.component.scss'],
})
export class RessourcesTbcSettingsComponent implements OnInit {
  readonly types = TYPES_RESSOURCES;
  readonly taille = octetsLisibles;
  disponibles: RessourceDisponible[] = [];
  peutGerer = false;
  gestion: GestionRessources | null = null;
  chargement = false;
  erreur = '';
  /** Opération en cours, par clé « niveau:type » (dépôt, retrait, téléchargement). */
  enCours: Record<string, boolean> = {};
  /** Description en cours d'édition, par id de ressource. */
  descriptions: Record<string, string> = {};

  constructor(private service: RessourcesTbcService, private toast: ToastService) {}

  ngOnInit(): void { this.charger(); }

  charger(): void {
    this.chargement = true; this.erreur = '';
    this.service.disponibles().subscribe({
      next: d => {
        this.disponibles = d.ressources; this.peutGerer = d.peut_gerer; this.chargement = false;
        if (this.peutGerer) this.chargerGestion();
      },
      error: e => { this.chargement = false; this.erreur = e?.error?.detail || 'Lecture des ressources TBC impossible.'; },
    });
  }

  chargerGestion(): void {
    this.service.gestion().subscribe({
      next: g => {
        this.gestion = g;
        this.descriptions = {};
        g.niveaux.forEach(n => this.types.forEach(t => {
          const r = n.ressources[t.type];
          if (r) this.descriptions[r.id] = r.description || '';
        }));
      },
      error: () => { this.gestion = null; },
    });
  }

  icone(type: TypeRessourceTbc): string { return this.types.find(t => t.type === type)?.icone || 'fa-file'; }

  provenance(r: RessourceTbc): string {
    return r.source === 'organisation' ? `Fournie par ${r.organisation?.nom}` : "Fournie par l'administration de l'application";
  }

  cle(niveau: NiveauRessources | null, type: TypeRessourceTbc): string {
    return `${niveau?.organisation?.id || 'application'}:${type}`;
  }

  telecharger(r: RessourceTbc): void {
    const k = `dl:${r.id}`;
    this.enCours[k] = true;
    this.service.telecharger(r.id).subscribe({
      next: rep => { this.enCours[k] = false; if (rep.body) enregistrerBlob(rep.body, r.nom_fichier); },
      error: e => { this.enCours[k] = false; this.toast.error('Téléchargement impossible', this.messageErreur(e)); },
    });
  }

  extensions(type: TypeRessourceTbc): string { return (this.gestion?.extensions[type] || []).join(','); }

  deposer(niveau: NiveauRessources, type: TypeRessourceTbc, input: HTMLInputElement): void {
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier) return;
    const attendues = this.gestion?.extensions[type] || [];
    const ext = fichier.name.includes('.') ? fichier.name.slice(fichier.name.lastIndexOf('.')).toLowerCase() : '';
    if (attendues.length && !attendues.includes(ext)) {
      this.toast.error('Format non accepté', `Formats acceptés : ${attendues.join(', ')}.`);
      return;
    }
    if (this.gestion && fichier.size > this.gestion.taille_max) {
      this.toast.error('Fichier trop volumineux', `${this.taille(this.gestion.taille_max)} au plus.`);
      return;
    }
    const k = this.cle(niveau, type);
    const actuelle = niveau.ressources[type];
    this.enCours[k] = true;
    this.service.deposer(type, fichier, niveau.organisation?.id || null, actuelle?.description || '').subscribe({
      next: () => {
        this.enCours[k] = false;
        this.toast.success(actuelle ? 'Fichier remplacé' : 'Fichier déposé', fichier.name);
        this.charger();
      },
      error: e => { this.enCours[k] = false; this.toast.error('Dépôt impossible', this.messageErreur(e)); },
    });
  }

  retirer(niveau: NiveauRessources, type: TypeRessourceTbc): void {
    const r = niveau.ressources[type];
    if (!r) return;
    const repli = niveau.organisation
      ? `Les membres de ${niveau.organisation.nom} téléchargeront alors celui de l'application.`
      : "Les organisations sans fichier propre n'auront plus rien à télécharger.";
    if (!window.confirm(`Retirer « ${r.nom_fichier} » ? ${repli}`)) return;
    const k = this.cle(niveau, type);
    this.enCours[k] = true;
    this.service.retirer(r.id).subscribe({
      next: () => { this.enCours[k] = false; this.toast.success('Fichier retiré', r.nom_fichier); this.charger(); },
      error: e => { this.enCours[k] = false; this.toast.error('Retrait impossible', this.messageErreur(e)); },
    });
  }

  descriptionModifiee(r: RessourceTbc): boolean {
    return (this.descriptions[r.id] ?? '') !== (r.description || '');
  }

  enregistrerDescription(r: RessourceTbc): void {
    this.service.modifierDescription(r.id, this.descriptions[r.id] || '').subscribe({
      next: maj => { r.description = maj.description; this.toast.success('Description enregistrée', r.nom_fichier); this.charger(); },
      error: e => this.toast.error('Enregistrement impossible', this.messageErreur(e)),
    });
  }

  private messageErreur(e: any): string {
    const err = e?.error;
    if (err && typeof err === 'object' && !(err instanceof Blob)) {
      if (err.detail) return err.detail;
      const premier = Object.values(err)[0];
      if (Array.isArray(premier) && premier.length) return String(premier[0]);
    }
    return 'Le serveur a refusé la demande.';
  }
}
