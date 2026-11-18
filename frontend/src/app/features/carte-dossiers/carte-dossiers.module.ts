import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { CarteDossiersPageComponent } from './carte-dossiers-page.component';

/** Carte des dossiers (tous rôles) — `/carte` et `/admin/carte`. */
const routes: Routes = [{ path: '', component: CarteDossiersPageComponent }];

@NgModule({
  declarations: [CarteDossiersPageComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)],
})
export class CarteDossiersModule {}
