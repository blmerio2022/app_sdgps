import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ActiviteComponent } from './activite.component';

/** Encadrement : tableau de bord d'activité. */
@NgModule({
  declarations: [ActiviteComponent],
  imports: [CommonModule, FormsModule],
  exports: [ActiviteComponent],
})
export class ActiviteModule {}
