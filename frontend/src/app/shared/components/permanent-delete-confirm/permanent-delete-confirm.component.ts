import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * CONFIRMATION DE SUPPRESSION DÉFINITIVE (irréversible) — composant partagé.
 *
 * Utilisé pour la purge d'un élément de la **corbeille**, à l'unité ou en masse. Les outils de
 * suppression définitive ne doivent être proposés QUE dans l'onglet corbeille (le parent porte
 * ce `*ngIf="showDeleted"`) : ce composant n'affiche que la confirmation.
 *
 * Composant PRÉSENTATIONNEL : le parent conserve l'état (cible, mode masse, indicateur en
 * cours) et exécute l'appel API sur `confirm`.
 */
@Component({
  selector: 'app-permanent-delete-confirm',
  templateUrl: './permanent-delete-confirm.component.html',
  styleUrls: ['./permanent-delete-confirm.component.scss'],
})
export class PermanentDeleteConfirmComponent {
  /** Affiche la modale. */
  @Input() open = false;
  /** Mode masse (sélection) plutôt qu'élément unique. */
  @Input() bulk = false;
  /** Nombre d'éléments concernés en mode masse. */
  @Input() count = 0;
  /**
   * Désignation de l'élément visé en mode unitaire (ex. « n° 12 », « Direction régionale »).
   * Mise en évidence dans le texte de confirmation.
   */
  @Input() label = '';
  /** Nom du type d'élément au singulier (ex. « organisme », « SSDGPS »). */
  @Input() entitySingular = 'élément';
  /** Nom du type d'élément au pluriel (ex. « organismes »). */
  @Input() entityPlural = 'éléments';
  /**
   * Sous-données bloquant la purge (ex. « organismes de deuxième niveau »). Quand c'est
   * renseigné, l'avertissement correspondant est affiché — le serveur refuse la purge d'un
   * élément qui en porte encore.
   */
  @Input() blockedBy = '';
  /** Suppression en cours (bouton en attente, actions verrouillées). */
  @Input() busy = false;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  /** Titre de la modale, adapté au mode. */
  get title(): string {
    return this.bulk
      ? `Supprimer définitivement ${this.count} ${this.count > 1 ? this.entityPlural : this.entitySingular} ?`
      : `Supprimer définitivement ce ${this.entitySingular} ?`;
  }

  onCancel(event?: Event): void {
    event?.stopPropagation();
    if (!this.busy) this.cancel.emit();
  }

  onConfirm(event?: Event): void {
    event?.stopPropagation();
    if (!this.busy) this.confirm.emit();
  }
}
