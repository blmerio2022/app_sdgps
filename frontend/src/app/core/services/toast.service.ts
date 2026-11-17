import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { PREFIXE_QUOTA } from './stockage.service';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  constructor(private toastr: ToastrService) {}

  /**
   * Afficher un toast de succès
   */
  success(title: string, message: string, duration?: number): void {
    this.toastr.success(message, title, {
      timeOut: duration || 3000
    });
  }

  /**
   * Afficher un toast d'erreur
   */
  error(title: string, message: string, duration?: number): void {
    // Refus pour quota de stockage dépassé : quel que soit l'écran qui l'affiche, il est
    // titré comme tel et reste lisible (le message explique organisation, consommation,
    // place restante et ce que l'envoi ajoutait) — un « Échec » de 4 s ne suffit pas.
    if (typeof message === 'string' && message.startsWith(PREFIXE_QUOTA)) {
      this.toastr.error(message, 'Quota de stockage de l\'organisation dépassé', {
        timeOut: Math.max(duration || 0, 15000), extendedTimeOut: 5000, closeButton: true,
      });
      return;
    }
    this.toastr.error(message, title, {
      timeOut: duration || 4000
    });
  }

  /**
   * Afficher un toast d'avertissement
   */
  warning(title: string, message: string, duration?: number): void {
    this.toastr.warning(message, title, {
      timeOut: duration || 3000
    });
  }

  /**
   * Afficher un toast d'information
   */
  info(title: string, message: string, duration?: number): void {
    this.toastr.info(message, title, {
      timeOut: duration || 3000
    });
  }
}
