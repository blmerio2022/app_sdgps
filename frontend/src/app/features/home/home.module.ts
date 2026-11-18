import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './home.component';
import { ReprendreTravailComponent } from './reprendre-travail/reprendre-travail.component';

/**
 * Module « Accueil » de l'opérateur (agent d'organisation) — tableau de bord `/home`.
 * Chargé en lazy depuis le groupe opérateur du routage racine.
 */
const routes: Routes = [
  { path: '', component: HomeComponent },
];

@NgModule({
  declarations: [HomeComponent, ReprendreTravailComponent],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
  ],
})
export class HomeModule {}
