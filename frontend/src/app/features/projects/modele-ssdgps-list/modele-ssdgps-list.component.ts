import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { ModeleSsdgps, PorteeModele } from '../../../core/models/modele-ssdgps.model';
import { PieceTypeDef } from '../../../core/models/piece.model';
import { NatureSsdgps } from '../../../core/models/project.model';
import { ModelesSsdgpsService } from '../../../core/services/modeles-ssdgps.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { NATURES_PRESENTATION } from '../sdgps-assistant/sdgps-assistant.component';

/**
 * « Modèles de SDGPS » : les modèles de l'application et les modèles personnels de
 * l'opérateur, en cartes. Créer, adapter (copie personnelle), modifier, supprimer, et
 * démarrer un nouveau dossier à partir d'un modèle.
 */
@Component({
  selector: 'app-modele-ssdgps-list',
  templateUrl: './modele-ssdgps-list.component.html',
  styleUrls: ['./modele-ssdgps-list.component.scss'],
})
export class ModeleSsdgpsListComponent implements OnInit, OnDestroy {
  readonly natures = NATURES_PRESENTATION;
  modeles: ModeleSsdgps[] = [];
  catalog: PieceTypeDef[] = [];
  loading = true;
  natureFilter: NatureSsdgps | '' = '';
  porteeFilter: PorteeModele | '' = '';
  search = '';
  expanded = new Set<string>();
  editorOpen = false;
  editorModele: ModeleSsdgps | null = null;
  readonly isAppAdmin: boolean;

  constructor(
    private service: ModelesSsdgpsService,
    private pieces: PiecesService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
    private breadcrumb: BreadcrumbService,
    auth: AuthService,
  ) { this.isAppAdmin = auth.isPlatformAdmin(); }

  ngOnInit(): void {
    this.pieces.getCatalog().subscribe({ next: c => (this.catalog = c), error: () => {} });
    this.load();
    const base = this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets';
    this.breadcrumb.set([
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: base, icon: 'fa-folder-open' },
      { label: 'Modèles de SDGPS', icon: 'fa-layer-group', isActive: true },
    ]);
  }

  ngOnDestroy(): void { this.breadcrumb.clear(); }

  load(): void {
    this.loading = true;
    this.service.list().subscribe({
      next: list => { this.modeles = list; this.loading = false; },
      error: () => { this.loading = false; this.toast.error('Erreur', 'Chargement des modèles impossible'); },
    });
  }

  get filtered(): ModeleSsdgps[] {
    const q = this.search.trim().toLowerCase();
    return this.modeles.filter(m =>
      (!this.natureFilter || m.nature_ssdgps === this.natureFilter) &&
      (!this.porteeFilter || m.portee === this.porteeFilter) &&
      (!q || `${m.nom} ${m.description || ''}`.toLowerCase().includes(q)));
  }

  countFor(nature: NatureSsdgps): number { return this.modeles.filter(m => m.nature_ssdgps === nature).length; }
  get personnelsCount(): number { return this.modeles.filter(m => m.portee === 'personnel').length; }

  toggle(m: ModeleSsdgps): void { this.expanded.has(m.id) ? this.expanded.delete(m.id) : this.expanded.add(m.id); }

  natureCourt(n: string): string { return n.replace('/GPS', ''); }

  sourceIcon(source: string | undefined): string {
    if (!source) return 'fa-table';
    if (source.startsWith('image')) return 'fa-image';
    if (source === 'calcul') return 'fa-calculator';
    return 'fa-table';
  }

  openEditor(m: ModeleSsdgps | null = null): void { this.editorModele = m; this.editorOpen = true; }
  closeEditor(): void { this.editorOpen = false; this.editorModele = null; }
  onSaved(): void { this.closeEditor(); this.load(); }

  duplicate(m: ModeleSsdgps): void {
    this.service.duplicate(m.id).subscribe({
      next: copie => { this.toast.success('Modèle dupliqué', copie.nom); this.load(); this.openEditor(copie); },
      error: () => this.toast.error('Erreur', 'Duplication impossible'),
    });
  }

  remove(m: ModeleSsdgps): void {
    if (!m.modifiable || !confirm(`Supprimer le modèle « ${m.nom} » ? Les dossiers déjà créés gardent leur liste de pièces.`)) return;
    this.service.delete(m.id).subscribe({
      next: () => { this.toast.success('Modèle supprimé', m.nom); this.load(); },
      error: () => this.toast.error('Erreur', 'Suppression impossible'),
    });
  }

  use(m: ModeleSsdgps): void {
    this.router.navigate(['../assistant'], { relativeTo: this.route, queryParams: { modele: m.id } });
  }
}
