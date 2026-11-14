import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { ReseauGpsPageComponent } from './reseau-gps-page/reseau-gps-page.component';
import { ReseauCarteComponent } from './reseau-carte/reseau-carte.component';
import { RgSectionComponent } from './rg-section/rg-section.component';
import { OngletPointsComponent } from './onglets/onglet-points.component';
import { OngletControleComponent } from './onglets/onglet-controle.component';
import { OngletEcartsComponent } from './onglets/onglet-ecarts.component';
import { OngletDensificationComponent } from './onglets/onglet-densification.component';
import { OngletFondsComponent } from './onglets/onglet-fonds.component';

/**
 * Module « Réseau de triangulation GPS » — indépendant du reste de l'application, ouvert à
 * TOUS les rôles (monté hors AdminGuard côté opérateur : `/reseau-gps`, et dans le groupe
 * admin : `/admin/reseau-gps`). Chargé à la demande (Leaflet n'alourdit pas le bundle initial).
 */
const routes: Routes = [
  { path: '', component: ReseauGpsPageComponent },
];

@NgModule({
  declarations: [
    ReseauGpsPageComponent, ReseauCarteComponent, RgSectionComponent,
    OngletPointsComponent, OngletControleComponent, OngletEcartsComponent,
    OngletDensificationComponent, OngletFondsComponent,
  ],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)],
})
export class ReseauGpsModule {}
