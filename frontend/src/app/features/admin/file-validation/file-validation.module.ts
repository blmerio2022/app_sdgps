import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { FileValidationComponent } from './file-validation.component';

/** Encadrement (Admin Organisation, administration de l'application) : file de validation. */
@NgModule({
  declarations: [FileValidationComponent],
  imports: [CommonModule, FormsModule],
  exports: [FileValidationComponent],
})
export class FileValidationModule {}
