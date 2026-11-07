import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { StorageQuotasComponent } from './storage-quotas.component';

/** Administration (Super Admin) : quotas de stockage par organisation. */
@NgModule({
  declarations: [StorageQuotasComponent],
  imports: [CommonModule, FormsModule, RouterModule],
  exports: [StorageQuotasComponent],
})
export class StorageQuotasModule {}
