import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { ReseauGpsPageComponent } from './reseau-gps-page/reseau-gps-page.component';
import { ReseauCarteComponent } from './reseau-carte/reseau-carte.component';

/**
 * Module « Réseau de triangulation GPS » — indépendant du reste de l'application, ouvert à
 * TOUS les rôles (monté hors AdminGuard côté opérateur : `/reseau-gps`, et dans le groupe
 * admin : `/admin/reseau-gps`). Chargé à la demande (Leaflet n'alourdit pas le bundle initial).
 */
const routes: Routes = [
  { path: '', component: ReseauGpsPageComponent },
];

@NgModule({
  declarations: [ReseauGpsPageComponent, ReseauCarteComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)],
})
export class ReseauGpsModule {}
