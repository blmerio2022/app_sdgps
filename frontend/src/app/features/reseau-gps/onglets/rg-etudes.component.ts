import { Component } from '@angular/core';
import { EtudeReseau, ReseauGpsService } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReseauGpsStore } from '../reseau-gps.store';

/** Groupe d'études affiché (un dossier, ou « Sans dossier »). */
export interface GroupeEtudes { dossier: string; etudes: EtudeReseau[]; }

/** Regroupe par dossier (épinglées d'abord dans chaque groupe, puis les plus récentes). */
export function grouperEtudes(etudes: EtudeReseau[]): GroupeEtudes[] {
  const groupes = new Map<string, EtudeReseau[]>();
  etudes.forEach(e => groupes.set(e.dossier || '', [...(groupes.get(e.dossier || '') || []), e]));
  return [...groupes.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'fr')))
    .map(([dossier, liste]) => ({
      dossier,
      etudes: liste.sort((x, y) => Number(y.epinglee) - Number(x.epinglee) || y.updated_at.localeCompare(x.updated_at)),
    }));
}

/**
 * Études du module : barre d'état (étude ouverte, enregistrement, autosauvegarde) et panneau
 * « Mes études » — ouvrir, enregistrer sous, renommer / ranger dans un dossier, épingler,
 * dupliquer, supprimer, exporter / importer un fichier. Les études sont personnelles.
 */
@Component({
  selector: 'app-rg-etudes',
  templateUrl: './rg-etudes.component.html',
  styleUrls: ['./rg-etudes.component.scss'],
})
export class RgEtudesComponent {
  ouvert = false;
  chargement = false;
  etudes: EtudeReseau[] = [];
  dossiers: string[] = [];
  recherche = '';
  /** Formulaire « Enregistrer sous » (création). */
  formulaire: { nom: string; dossier: string; description: string } | null = null;
  /** Étude en cours de renommage / rangement. */
  edition: { id: string; nom: string; dossier: string; description: string } | null = null;

  constructor(public store: ReseauGpsStore, private service: ReseauGpsService, private toast: ToastService) {}

  get groupes(): GroupeEtudes[] { return grouperEtudes(this.etudes); }

  get statut(): string {
    const s = this.store;
    if (s.sauvegardeEnCours) return 'Enregistrement…';
    if (s.erreurSauvegarde) return 'Échec de l’enregistrement';
    if (!s.etude) return s.modifie ? 'Travail non enregistré' : 'Aucune étude ouverte';
    if (s.modifie) return 'Modifications non enregistrées';
    return s.derniereSauvegarde
      ? `Enregistrée à ${s.derniereSauvegarde.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Enregistrée';
  }

  ouvrirPanneau(): void {
    this.ouvert = true;
    this.charger();
  }

  charger(): void {
    this.chargement = true;
    this.service.etudes(this.recherche.trim()).subscribe({
      next: r => { this.etudes = r.etudes; this.dossiers = r.dossiers; this.chargement = false; },
      error: () => { this.chargement = false; this.toast.error('Études', 'Liste des études indisponible.'); },
    });
  }

  enregistrer(): void {
    if (this.store.etude) this.store.enregistrer();
    else this.nouveauFormulaire();
  }

  nouveauFormulaire(): void {
    this.ouvert = true;
    this.charger();
    this.formulaire = { nom: this.store.etude ? `${this.store.etude.nom} (copie)` : this.nomPropose(), dossier: this.store.etude?.dossier || '',
                        description: '' };
  }

  private nomPropose(): string {
    const zone = this.store.zones[0]?.nom;
    const date = new Date().toLocaleDateString('fr-FR');
    return zone ? `${zone} — ${date}` : `Étude du ${date}`;
  }

  validerFormulaire(): void {
    const f = this.formulaire;
    if (!f || !f.nom.trim()) return;
    this.store.enregistrer({ nom: f.nom.trim(), dossier: f.dossier.trim(), description: f.description.trim() });
    this.formulaire = null;
    setTimeout(() => this.charger(), 600);
  }

  private confirmerAbandon(): boolean {
    return !this.store.modifie || window.confirm('Les modifications non enregistrées seront perdues. Continuer ?');
  }

  ouvrir(e: EtudeReseau): void {
    if (!this.confirmerAbandon()) return;
    this.store.ouvrirEtude(e.id);
    this.ouvert = false;
  }

  nouvelle(): void {
    if (!this.confirmerAbandon()) return;
    this.store.nouvelleEtude();
    this.ouvert = false;
  }

  commencerEdition(e: EtudeReseau): void {
    this.edition = { id: e.id, nom: e.nom, dossier: e.dossier, description: e.description };
  }

  validerEdition(): void {
    const ed = this.edition;
    if (!ed || !ed.nom.trim()) return;
    this.service.modifierEtude(ed.id, { nom: ed.nom.trim(), dossier: ed.dossier.trim(), description: ed.description.trim() })
      .subscribe({
        next: e => { this.edition = null; this.store.majEtudeOuverte(e); this.charger(); },
        error: () => this.toast.error('Études', 'Modification impossible.'),
      });
  }

  epingler(e: EtudeReseau): void {
    this.service.modifierEtude(e.id, { epinglee: !e.epinglee }).subscribe({ next: () => this.charger() });
  }

  dupliquer(e: EtudeReseau): void {
    this.service.dupliquerEtude(e.id).subscribe({
      next: c => { this.toast.success('Études', `« ${c.nom} » créée.`); this.charger(); },
      error: () => this.toast.error('Études', 'Duplication impossible.'),
    });
  }

  supprimer(e: EtudeReseau): void {
    if (!window.confirm(`Supprimer l'étude « ${e.nom} » ?`)) return;
    this.service.supprimerEtude(e.id).subscribe({
      next: () => {
        if (this.store.etude?.id === e.id) this.store.majEtudeOuverte(null);
        this.charger();
      },
      error: () => this.toast.error('Études', 'Suppression impossible.'),
    });
  }

  exporter(): void {
    const nom = (this.store.etude?.nom || 'etude-reseau-gnss').replace(/[^\p{L}\p{N}_-]+/gu, '_');
    const blob = new Blob([this.store.exporterEtude()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nom}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  importer(event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier || !this.confirmerAbandon()) return;
    fichier.text().then(t => { if (this.store.importerEtude(t)) this.ouvert = false; });
  }

  taille(o: number): string {
    return o < 1024 ? `${o} o` : o < 1024 * 1024 ? `${Math.round(o / 1024)} Ko` : `${(o / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  }
}
