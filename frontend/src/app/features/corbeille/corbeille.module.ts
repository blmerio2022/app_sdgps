import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { CorbeillePageComponent } from './corbeille-page.component';

/** Corbeille générale (tous rôles) — `/corbeille` et `/admin/corbeille`. */
const routes: Routes = [{ path: '', component: CorbeillePageComponent }];

@NgModule({
  declarations: [CorbeillePageComponent],
  imports: [CommonModule, FormsModule, SharedModule, RouterModule.forChild(routes)],
})
export class CorbeilleModule {}
