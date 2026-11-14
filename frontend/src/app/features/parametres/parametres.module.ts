import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { PieceSortSettingsComponent } from '../profile/components/piece-sort-settings/piece-sort-settings.component';
import { PieceFieldsSettingsComponent } from '../profile/components/piece-fields-settings/piece-fields-settings.component';
import { TolerancesSettingsComponent } from '../profile/components/tolerances-settings/tolerances-settings.component';

/**
 * Module « Paramètres » (préférences d'affichage des pièces : tri + champs par défaut).
 * Monté à la racine `parametres` (opérateur `/parametres`, admin `/admin/parametres`)
 * afin que l'URL ne comporte plus le segment `profile/` — le fil d'Ariane n'affiche donc plus
 * « Mon profil » pour ces pages. Les composants sont déclarés ici (déplacés depuis ProfileModule).
 */
const routes: Routes = [
  // Le parent « Paramètres » du sidebar est un sous-menu (pas de navigation) ; on redirige
  // néanmoins l'index vers la première page utile pour un accès direct par URL.
  { path: '', pathMatch: 'full', redirectTo: 'tri-pieces' },
  { path: 'tri-pieces', component: PieceSortSettingsComponent },
  { path: 'champs-pieces', component: PieceFieldsSettingsComponent },
  { path: 'tolerances', component: TolerancesSettingsComponent },
];

@NgModule({
  declarations: [PieceSortSettingsComponent, PieceFieldsSettingsComponent, TolerancesSettingsComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    RouterModule.forChild(routes),
  ],
})
export class ParametresModule {}
