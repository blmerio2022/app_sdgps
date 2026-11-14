import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { NouvelleVersionBannerComponent } from './nouvelle-version-banner.component';
import { VersionBadgeComponent } from './version-badge.component';

/** Version de l'application : badge (connexion, menu) + bandeau « nouvelle version ». */
@NgModule({
  declarations: [VersionBadgeComponent, NouvelleVersionBannerComponent],
  imports: [CommonModule],
  exports: [VersionBadgeComponent, NouvelleVersionBannerComponent],
})
export class VersionModule {}
