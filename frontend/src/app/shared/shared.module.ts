import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldInfoComponent } from './components/field-info/field-info.component';
import { MultiLevelSortComponent } from './components/multi-level-sort/multi-level-sort.component';
import { TableHeaderTooltipDirective } from './directives/table-header-tooltip.directive';
import { ColumnFilterComponent } from './components/column-filter/column-filter.component';
import { PermanentDeleteConfirmComponent } from './components/permanent-delete-confirm/permanent-delete-confirm.component';
import { TablePaginationComponent } from './components/table-pagination/table-pagination.component';
import { ColumnConfigComponent } from './components/column-config/column-config.component';

@NgModule({
  declarations: [
    FieldInfoComponent,
    MultiLevelSortComponent,
    ColumnConfigComponent,
    ColumnFilterComponent,
    PermanentDeleteConfirmComponent,
    TablePaginationComponent,
    TableHeaderTooltipDirective
  ],
  imports: [
    CommonModule,
    FormsModule
  ],
  exports: [
    FieldInfoComponent,
    MultiLevelSortComponent,
    ColumnConfigComponent,
    ColumnFilterComponent,
    PermanentDeleteConfirmComponent,
    TablePaginationComponent,
    TableHeaderTooltipDirective
  ]
})
export class SharedModule { }
