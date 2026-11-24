import { Component } from '@angular/core';
import { EtudeReseau, ReseauGpsService } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReseauGpsStore, VERSION_CONTENU } from '../reseau-gps.store';

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

/** Nom de fichier sûr (lettres, chiffres, tirets). */
export function nomDeFichier(nom: string): string {
  return (nom || 'etude-reseau-gnss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'etude-reseau-gnss';
}

/**
 * Études du module : barre d'état (étude ouverte, enregistrement, autosauvegarde) et panneau
 * « Mes études » — ouvrir, nouvelle, enregistrer sous, renommer / ranger dans un dossier,
 * épingler, dupliquer, exporter, supprimer (confirmation sur place), importer un fichier.
 *
 * ⚠ Les groupes sont CALCULÉS UNE FOIS par chargement (`groupes`) et les lignes suivies par
 * identifiant : un accesseur qui recréait les groupes à chaque détection de changements
 * reconstruisait les lignes entre l'appui et le relâchement du bouton — le clic se perdait
 * (ouvrir, renommer, supprimer… restaient sans effet).
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
  groupes: GroupeEtudes[] = [];
  dossiers: string[] = [];
  recherche = '';
  /** Formulaire « Enregistrer sous » (création). */
  formulaire: { nom: string; dossier: string; description: string } | null = null;
  /** Étude en cours de renommage / rangement. */
  edition: { id: string; nom: string; dossier: string; description: string } | null = null;
  /** Étude dont la suppression attend confirmation. */
  aSupprimer: string | null = null;
  /** Action en cours par étude (ouverture, export…). */
  occupe: Record<string, boolean> = {};

  constructor(public store: ReseauGpsStore, private service: ReseauGpsService, private toast: ToastService) {}

  get statut(): string {
    const s = this.store;
    if (s.sauvegardeEnCours) return 'Enregistrement…';
    if (s.erreurSauvegarde) return 'Échec de l’enregistrement';
    if (!s.etude) return s.modifie ? 'Travail non enregistré' : 'Aucune étude ouverte';
    if (s.modifie) return 'Modifications non enregistrées';
    return s.derniereSauvegarde
      ? `Enregistrée à ${s.derniereSauvegarde.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Enregistrée';
  }

  /** Teinte de la pastille d'état : ok, attente, alerte, erreur, neutre. */
  get etat(): 'ok' | 'attente' | 'alerte' | 'erreur' | 'neutre' {
    const s = this.store;
    if (s.sauvegardeEnCours) return 'attente';
    if (s.erreurSauvegarde) return 'erreur';
    if (s.modifie) return 'alerte';
    return s.etude ? 'ok' : 'neutre';
  }

  ouvrirPanneau(): void {
    this.ouvert = true;
    this.aSupprimer = null;
    this.charger();
  }

  fermer(): void {
    this.ouvert = false;
    this.formulaire = null;
    this.edition = null;
    this.aSupprimer = null;
  }

  charger(): void {
    this.chargement = true;
    this.service.etudes(this.recherche.trim()).subscribe({
      next: r => {
        this.etudes = r.etudes;
        this.groupes = grouperEtudes([...r.etudes]);
        this.dossiers = r.dossiers;
        this.chargement = false;
      },
      error: () => { this.chargement = false; this.toast.error('Études', 'Liste des études indisponible.'); },
    });
  }

  enregistrer(): void {
    if (this.store.etude) this.store.enregistrer();
    else this.nouveauFormulaire();
  }

  nouveauFormulaire(): void {
    if (!this.ouvert) { this.ouvert = true; this.charger(); }
    this.edition = null;
    this.formulaire = { nom: this.store.etude ? `${this.store.etude.nom} (copie)` : this.nomPropose(),
                        dossier: this.store.etude?.dossier || '', description: '' };
  }

  private nomPropose(): string {
    const zone = this.store.zoneEtude?.nom || this.store.zones[0]?.nom;
    const date = new Date().toLocaleDateString('fr-FR');
    return zone ? `${zone} — ${date}` : `Étude du ${date}`;
  }

  validerFormulaire(): void {
    const f = this.formulaire;
    if (!f || !f.nom.trim()) return;
    this.store.enregistrer({ nom: f.nom.trim(), dossier: f.dossier.trim(), description: f.description.trim() });
    this.formulaire = null;
    setTimeout(() => this.charger(), 700);
  }

  private confirmerAbandon(): boolean {
    return !this.store.modifie || window.confirm('Les modifications non enregistrées seront perdues. Continuer ?');
  }

  ouvrir(e: EtudeReseau): void {
    if (this.store.etude?.id === e.id && !this.store.modifie) { this.fermer(); return; }
    if (!this.confirmerAbandon()) return;
    this.occupe[e.id] = true;
    this.store.ouvrirEtude(e.id, ok => {
      this.occupe[e.id] = false;
      if (ok) this.fermer();
    });
  }

  nouvelle(): void {
    if (!this.confirmerAbandon()) return;
    this.store.nouvelleEtude();
    this.fermer();
    this.toast.success('Études', 'Nouvelle étude : l’espace de travail est vide.');
  }

  commencerEdition(e: EtudeReseau): void {
    this.formulaire = null;
    this.aSupprimer = null;
    this.edition = { id: e.id, nom: e.nom, dossier: e.dossier, description: e.description };
  }

  validerEdition(): void {
    const ed = this.edition;
    if (!ed || !ed.nom.trim()) return;
    this.service.modifierEtude(ed.id, { nom: ed.nom.trim(), dossier: ed.dossier.trim(), description: ed.description.trim() })
      .subscribe({
        next: e => {
          this.edition = null;
          this.store.majEtudeOuverte(e);
          this.toast.success('Études', `« ${e.nom} » mise à jour.`);
          this.charger();
        },
        error: err => this.toast.error('Études', err?.error?.nom?.[0] || 'Modification impossible.'),
      });
  }

  epingler(e: EtudeReseau): void {
    this.service.modifierEtude(e.id, { epinglee: !e.epinglee }).subscribe({
      next: maj => { this.store.majEtudeOuverte(maj); this.charger(); },
      error: () => this.toast.error('Études', 'Épinglage impossible.'),
    });
  }

  dupliquer(e: EtudeReseau): void {
    this.occupe[e.id] = true;
    this.service.dupliquerEtude(e.id).subscribe({
      next: c => { this.occupe[e.id] = false; this.toast.success('Études', `« ${c.nom} » créée.`); this.charger(); },
      error: () => { this.occupe[e.id] = false; this.toast.error('Études', 'Duplication impossible.'); },
    });
  }

  demanderSuppression(e: EtudeReseau): void {
    this.edition = null;
    this.aSupprimer = e.id;
  }

  supprimer(e: EtudeReseau): void {
    this.service.supprimerEtude(e.id).subscribe({
      next: () => {
        this.aSupprimer = null;
        if (this.store.etude?.id === e.id) this.store.majEtudeOuverte(null);
        this.toast.success('Études', `« ${e.nom} » supprimée.`);
        this.charger();
      },
      error: () => this.toast.error('Études', 'Suppression impossible.'),
    });
  }

  private telecharger(texte: string, nom: string): void {
    const blob = new Blob([texte], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nomDeFichier(nom)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Exporte le travail en cours (même non enregistré). */
  exporter(): void { this.telecharger(this.store.exporterEtude(), this.store.etude?.nom || 'etude-reseau-gnss'); }

  /** Exporte une étude enregistrée de la liste, sans l'ouvrir. */
  exporterEtude(e: EtudeReseau): void {
    this.occupe[e.id] = true;
    this.service.etude(e.id).subscribe({
      next: complete => {
        this.occupe[e.id] = false;
        this.telecharger(JSON.stringify({ format: 'sdgps-reseau-gnss', version: VERSION_CONTENU, nom: complete.nom,
                                          contenu: complete.contenu || {} }), complete.nom);
      },
      error: () => { this.occupe[e.id] = false; this.toast.error('Études', 'Export impossible.'); },
    });
  }

  importer(event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier || !this.confirmerAbandon()) return;
    fichier.text().then(t => { if (this.store.importerEtude(t)) this.fermer(); });
  }

  taille(o: number): string {
    return o < 1024 ? `${o} o` : o < 1024 * 1024 ? `${Math.round(o / 1024)} Ko` : `${(o / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  }

  trackGroupe(_: number, g: GroupeEtudes): string { return g.dossier; }
  trackEtude(_: number, e: EtudeReseau): string { return e.id; }
}
