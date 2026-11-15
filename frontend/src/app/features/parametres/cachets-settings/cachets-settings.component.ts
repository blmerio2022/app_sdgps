import { Component } from '@angular/core';
import { CachetSignature } from '../../../core/models/cachet-signature.model';

/**
 * Paramètres › Cachets et signatures — la bibliothèque personnelle de l'opérateur.
 * Les cachets se créent aussi depuis la modale Rapport PDF ; cette page sert à les
 * gérer à froid (reprendre un détourage, changer le défaut, faire le ménage).
 */
@Component({
  selector: 'app-cachets-settings',
  templateUrl: './cachets-settings.component.html',
  styleUrls: ['./cachets-settings.component.scss'],
})
export class CachetsSettingsComponent {
  total = 0;
  onCachets(liste: CachetSignature[]): void { this.total = liste.length; }
}
