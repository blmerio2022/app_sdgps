import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SauvegardesComponent } from './sauvegardes.component';

/** Administration de l'application : sauvegardes de la base. */
@NgModule({
  declarations: [SauvegardesComponent],
  imports: [CommonModule, FormsModule],
  exports: [SauvegardesComponent],
})
export class SauvegardesModule {}
