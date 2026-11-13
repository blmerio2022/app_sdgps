import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ProjectsRoutingModule } from './projects-routing.module';
import { SharedModule } from '../../shared/shared.module';
import { ProjectListComponent } from './project-list/project-list.component';
import { ProjectExplorerComponent } from './project-explorer/project-explorer.component';
import { ProjectSsdgpsListComponent } from './project-ssdgps-list/project-ssdgps-list.component';
import { PieceColumnMapperComponent } from './piece-column-mapper/piece-column-mapper.component';
import { PieceManagementPageComponent } from './piece-management-page/piece-management-page.component';
import { PieceAddWizardComponent } from './piece-add-wizard/piece-add-wizard.component';
import { PieceDetailModalComponent } from './piece-detail-modal/piece-detail-modal.component';
import { PieceImageGalleryComponent } from './piece-image-gallery/piece-image-gallery.component';
import { PieceAddPageComponent } from './piece-add-page/piece-add-page.component';
import { PieceDetailPageComponent } from './piece-detail-page/piece-detail-page.component';
import { PiecePhotoPointsComponent } from './piece-photo-points/piece-photo-points.component';
import { PieceDataTableComponent } from './piece-data-table/piece-data-table.component';
import { SdgpsAssistantComponent } from './sdgps-assistant/sdgps-assistant.component';
import { ModeleSsdgpsEditorComponent } from './modele-ssdgps-editor/modele-ssdgps-editor.component';
import { ModeleSsdgpsListComponent } from './modele-ssdgps-list/modele-ssdgps-list.component';

@NgModule({
  declarations: [
    ProjectListComponent, ProjectExplorerComponent, ProjectSsdgpsListComponent,
    PieceColumnMapperComponent, PieceManagementPageComponent, PieceAddWizardComponent,
    PieceDetailModalComponent, PieceImageGalleryComponent,
    PieceAddPageComponent, PieceDetailPageComponent, PiecePhotoPointsComponent,
    PieceDataTableComponent,
    SdgpsAssistantComponent, ModeleSsdgpsEditorComponent, ModeleSsdgpsListComponent,
  ],
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ProjectsRoutingModule, SharedModule],
})
export class ProjectsModule {}
