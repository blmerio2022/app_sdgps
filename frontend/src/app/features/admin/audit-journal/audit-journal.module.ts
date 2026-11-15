import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SharedModule } from '../../../shared/shared.module';
import { AuditJournalComponent } from './audit-journal.component';

/** Administration (Super Admin, Admin Système) : consultation du journal d'audit. */
@NgModule({
  declarations: [AuditJournalComponent],
  imports: [CommonModule, FormsModule, SharedModule],
  exports: [AuditJournalComponent],
})
export class AuditJournalModule {}
