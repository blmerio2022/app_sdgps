import {Component} from '@angular/core';
import {VersionService} from './core/version/version.service';

/**
 * @component AppComponent
 * @description Composant racine de l'application SDGPS.
 *              Ce composant sert de point d'entrée principal et contient le router-outlet
 *              pour afficher les différents composants selon les routes.
 */
@Component({
    selector: 'app-root',
    // Bandeau « nouvelle version » : global, au-dessus de toutes les pages (connecté ou non).
    template: '<router-outlet></router-outlet><app-nouvelle-version></app-nouvelle-version>',
    styles: []
})
export class AppComponent {
    title = 'SDGPS - Système de Génération de Documents';

    constructor(versions: VersionService) {
        versions.demarrer();
    }
}
