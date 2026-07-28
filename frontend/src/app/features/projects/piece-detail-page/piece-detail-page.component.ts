import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ProjectsService } from '../../../core/services/projects.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/layout/interfaces/menu.interface';
import { Piece, PieceTypeDef } from '../../../core/models/piece.model';
import { AutoSaveState } from '../piece-detail-modal/piece-detail-modal.component';
import { Ssdgps, Session, Projet } from '../../../core/models/project.model';

/**
 * Page dédiée de modification d'une pièce (architecture hybride). Charge la pièce
 * par son id (deep-link possible) + le contexte SSDGPS, puis héberge
 * `piece-detail-modal` en mode `embedded` + `edit`.
 */
@Component({
  selector: 'app-piece-detail-page',
  templateUrl: './piece-detail-page.component.html',
  styleUrls: ['./piece-detail-page.component.scss'],
})
export class PieceDetailPageComponent implements OnInit, OnDestroy {
  loading = false;
  mode: 'view' | 'edit' = 'view';
  piece: Piece | null = null;
  ssdgps!: Ssdgps;
  sessions: Session[] = [];
  catalog: PieceTypeDef[] = [];

  private projectId!: string;
  private ssdgpsId!: string;
  private pieceId!: string;
  private proprieteId: string | null = null;
  private affaireId: string | null = null;
  private sessionId: string | null = null;
  private projet: Projet | null = null;

  constructor(
    private projectsService: ProjectsService,
    private piecesService: PiecesService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
    private breadcrumb: BreadcrumbService,
  ) {}

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id')!;
    this.ssdgpsId = this.route.snapshot.paramMap.get('ssdgpsId')!;
    this.pieceId = this.route.snapshot.paramMap.get('pieceId')!;
    this.mode = this.route.snapshot.data['mode'] === 'edit' ? 'edit' : 'view';
    this.proprieteId = this.route.snapshot.queryParamMap.get('proprieteId');
    this.affaireId = this.route.snapshot.queryParamMap.get('affaireId');
    this.sessionId = this.route.snapshot.queryParamMap.get('session');
    this.loading = true;
    forkJoin([
      this.projectsService.getSsdgpsById(this.ssdgpsId),
      this.projectsService.getSessions(this.ssdgpsId),
      this.piecesService.getCatalog(),
      this.piecesService.getById(this.pieceId),
    ]).subscribe({
      next: ([ssdgps, sessions, catalog, piece]) => {
        this.ssdgps = ssdgps; this.sessions = sessions;
        this.catalog = catalog; this.piece = piece;
        this.loading = false;
        this.updateTopbarBreadcrumb();
      },
      error: () => { this.toast.error('Erreur', 'Pièce introuvable'); this.backToList(); },
    });

    // Nom du projet pour le fil d'Ariane (fetch séparé : son échec ne casse pas la page).
    this.projectsService.getProjet(this.projectId).subscribe({
      next: (p) => { this.projet = p; this.updateTopbarBreadcrumb(); },
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear();
  }

  /** Libellé métier de la pièce en cours (type + numéro pour les types répétables). */
  private pieceLabel(): string {
    if (!this.piece) return 'Pièce';
    const nom = this.catalogDef?.nom || this.piece.type_piece;
    return this.piece.numero ? `${nom} n°${this.piece.numero}` : nom;
  }

  /**
   * Fil d'Ariane métier : Accueil › Projets › <Projet> › <Propriété> › <Affaire> ›
   * <SSDGPS N°x> › [Session N°y] › Pièces › <Pièce en cours>. « Pièces » ramène à la
   * page de gestion des pièces du SSDGPS ; le dernier crumb (la pièce) est actif.
   */
  private updateTopbarBreadcrumb(): void {
    if (!this.ssdgps) return;
    const base = this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets';
    const projRoute = `${base}/${this.projectId}`;
    const piecesRoute = `${base}/${this.projectId}/pieces/${this.ssdgpsId}`;
    const s = this.ssdgps as any;
    const hasParents = !!(this.proprieteId && this.affaireId);
    const isMulti = this.ssdgps.type_ssdgps === 'multi-session';
    const currentSession = this.sessionId ? this.sessions.find(x => x.id === this.sessionId) : undefined;
    // Query params communs pour revenir au bon contexte des pièces.
    const pieceQp: Record<string, any> = { proprieteId: this.proprieteId, affaireId: this.affaireId, session: this.sessionId };

    const trail: BreadcrumbItem[] = [
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: base, icon: 'fa-folder-open' },
      { label: this.projet?.nom_projet || this.projet?.code_projet || 'Projet', route: projRoute, icon: 'fa-diagram-project' },
    ];
    // Propriété : TOUJOURS l'identifiant (titre foncier, sinon réquisition), jamais la propriété-dite.
    // Cliquable → explorateur au niveau Affaire de cette propriété (restoreToAffaireLevel).
    const proprieteLabel = s.propriete_id_titre || s.propriete_id_requisition || s.propriete_nom;
    if (proprieteLabel) {
      trail.push({
        label: proprieteLabel, icon: 'fa-map-marker-alt',
        ...(hasParents ? { route: projRoute, queryParams: { proprieteId: this.proprieteId } } : {}),
      });
    }
    if (s.affaire_numero != null) {
      trail.push({
        label: `SD ${s.affaire_numero}`, icon: 'fa-file-signature',
        ...(hasParents ? { route: projRoute, queryParams: { proprieteId: this.proprieteId, affaireId: this.affaireId } } : {}),
      });
    }
    trail.push({
      label: `SSDGPS ${this.ssdgps.numero_ssdgps}`, icon: 'fa-satellite-dish',
      ...(hasParents ? {
        route: projRoute,
        queryParams: isMulti
          ? { proprieteId: this.proprieteId, affaireId: this.affaireId, ssdgpsId: this.ssdgps.id }
          : { proprieteId: this.proprieteId, affaireId: this.affaireId },
      } : {}),
    });
    if (isMulti && currentSession) {
      trail.push({ label: `Session ${currentSession.numero_session}`, icon: 'fa-clock' });
    }
    // « Pièces » cliquable → page de gestion des pièces du SSDGPS.
    trail.push({ label: 'Pièces', icon: 'fa-paperclip', route: piecesRoute, queryParams: pieceQp });
    // Pièce en cours (consultation/modification) — actif.
    trail.push({ label: this.pieceLabel(), icon: 'fa-file-lines', isActive: true });
    this.breadcrumb.set(trail);
  }

  /** Définition catalogue de la pièce (pour le nom complet du type dans le titre de page). */
  get catalogDef(): PieceTypeDef | undefined {
    return this.piece ? this.catalog.find(d => d.code === this.piece!.type_piece) : undefined;
  }

  backToList(): void {
    this.router.navigate(['/projets', this.projectId, 'pieces', this.ssdgpsId], {
      queryParams: { proprieteId: this.proprieteId, affaireId: this.affaireId, session: this.sessionId },
    });
  }

  onSaved(updated: Piece): void { this.piece = updated; }

  /** État de la sauvegarde automatique, remonté par le composant hébergé : la mention est
   * affichée dans l'en-tête de page (et non dans le corps) pour économiser une bande. */
  autoSaveState: AutoSaveState = 'idle';
  onAutoSaveState(state: AutoSaveState): void { this.autoSaveState = state; }

  /** Bascule vers l'autre mode pour la MÊME pièce (routes sœurs `…/piece/:id` et
   * `…/piece/:id/modifier`). Le contexte de navigation est conservé pour que le retour
   * et le fil d'Ariane restent justes. */
  switchMode(target: 'view' | 'edit'): void {
    if (target === this.mode) return;
    const path = ['/projets', this.projectId, 'pieces', this.ssdgpsId, 'piece', this.pieceId];
    if (target === 'edit') path.push('modifier');
    this.router.navigate(path, {
      queryParams: { proprieteId: this.proprieteId, affaireId: this.affaireId, session: this.sessionId },
    });
  }

  /** Depuis la consultation, bascule vers la page d'édition (même pièce). */
  goToEdit(): void { this.switchMode('edit'); }

  /** Depuis la modification, revient à la consultation (même pièce). */
  goToView(): void { this.switchMode('view'); }
}
