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
import { CachetEditorComponent } from './components/cachet-signature/cachet-editor/cachet-editor.component';
import { CachetLibraryComponent } from './components/cachet-signature/cachet-library/cachet-library.component';
import { CachetPickerComponent } from './components/cachet-signature/cachet-picker/cachet-picker.component';
import { IaAssistantComponent } from './components/ia-assistant/ia-assistant.component';

@NgModule({
  declarations: [
    FieldInfoComponent,
    MultiLevelSortComponent,
    ColumnConfigComponent,
    ColumnFilterComponent,
    PermanentDeleteConfirmComponent,
    TablePaginationComponent,
    TableHeaderTooltipDirective,
    CachetEditorComponent,
    CachetLibraryComponent,
    CachetPickerComponent,
    IaAssistantComponent
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
    TableHeaderTooltipDirective,
    CachetEditorComponent,
    CachetLibraryComponent,
    CachetPickerComponent,
    IaAssistantComponent
  ]
})
export class SharedModule { }
