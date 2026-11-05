import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { SharedModule } from '../../../shared/shared.module';
import { OrganismeListComponent } from './organisme-list/organisme-list.component';

@NgModule({
  declarations: [OrganismeListComponent],
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, SharedModule],
  exports: [OrganismeListComponent],
})
export class OrganismesModule {}
