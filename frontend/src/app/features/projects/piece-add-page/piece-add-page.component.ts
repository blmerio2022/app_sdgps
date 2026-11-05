import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ProjectsService } from '../../../core/services/projects.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { ToastService } from '../../../core/services/toast.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/layout/interfaces/menu.interface';
import { Piece, PieceTypeDef } from '../../../core/models/piece.model';
import { Ssdgps, Session, Projet } from '../../../core/models/project.model';

/**
 * Page dédiée d'ajout d'une pièce (architecture hybride). Résout le contexte
 * (SSDGPS, sessions, catalogue, pièces existantes) comme `piece-management-page`,
 * puis héberge `piece-add-wizard` en mode `embedded`. Navigue en retour vers la
 * liste à la création ou à l'annulation.
 */
@Component({
  selector: 'app-piece-add-page',
  templateUrl: './piece-add-page.component.html',
  styleUrls: ['./piece-add-page.component.scss'],
})
export class PieceAddPageComponent implements OnInit, OnDestroy {
  loading = false;
  ssdgps!: Ssdgps;
  sessions: Session[] = [];
  catalog: PieceTypeDef[] = [];
  existingPieces: Piece[] = [];
  defaultSessionId: string | null = null;

  /** Type en cours de création, remonté par l'assistant — sert à titrer la page. */
  selectedType: PieceTypeDef | null = null;

  private projectId!: string;
  private ssdgpsId!: string;
  private proprieteId: string | null = null;
  private affaireId: string | null = null;
  private sessionId: string | null = null;
  private projet: Projet | null = null;

  onTypeSelected(def: PieceTypeDef | null): void { this.selectedType = def; }

  /**
   * Chemin complet de la pièce en cours d'ajout :
   * `propriété › affaire › SSDGPS › session`. La session n'apparaît que pour un SSDGPS
   * multi-session dont la session de destination est connue. Mêmes identifiants et mêmes
   * icônes que le fil d'Ariane, pour que les deux se relisent sans effort de traduction.
   */
  get pathSegments(): { icon: string; label: string }[] {
    if (!this.ssdgps) return [];
    const s = this.ssdgps as any;
    const segs: { icon: string; label: string }[] = [];
    // Propriété : TOUJOURS l'identifiant (titre foncier, sinon réquisition).
    const propriete = s.propriete_id_titre || s.propriete_id_requisition || s.propriete_nom;
    if (propriete) segs.push({ icon: 'fa-map-marker-alt', label: propriete });
    if (s.affaire_numero != null) segs.push({ icon: 'fa-file-signature', label: `SD ${s.affaire_numero}` });
    segs.push({ icon: 'fa-satellite-dish', label: `SSDGPS ${this.ssdgps.numero_ssdgps}` });
    const session = this.sessionId ? this.sessions.find(x => x.id === this.sessionId) : undefined;
    if (this.ssdgps.type_ssdgps === 'multi-session' && session) {
      segs.push({ icon: 'fa-clock', label: `Session ${session.numero_session}` });
    }
    return segs;
  }

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
    this.proprieteId = this.route.snapshot.queryParamMap.get('proprieteId');
    this.affaireId = this.route.snapshot.queryParamMap.get('affaireId');
    this.sessionId = this.route.snapshot.queryParamMap.get('session');
    this.defaultSessionId = this.sessionId;
    this.loading = true;
    forkJoin([
      this.projectsService.getSsdgpsById(this.ssdgpsId),
      this.projectsService.getSessions(this.ssdgpsId),
      this.piecesService.getCatalog(),
      this.piecesService.listBySsdgps(this.ssdgpsId, false),
    ]).subscribe({
      next: ([ssdgps, sessions, catalog, pieces]) => {
        this.ssdgps = ssdgps; this.sessions = sessions;
        this.catalog = catalog; this.existingPieces = pieces;
        this.loading = false;
        this.updateTopbarBreadcrumb();
      },
      error: () => { this.toast.error('Erreur', 'SSDGPS introuvable'); this.backToList(); },
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

  /**
   * Fil d'Ariane métier : Accueil › Projets › <Projet> › <Propriété> › <Affaire> ›
   * <SSDGPS N°x> › [Session N°y] › Pièces › Ajouter une pièce. « Pièces » ramène à la
   * page de gestion des pièces du SSDGPS ; le dernier crumb (l'action d'ajout) est actif.
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
    // Action d'ajout dans le SSDGPS en cours — actif.
    trail.push({ label: 'Ajouter une pièce', icon: 'fa-plus-circle', isActive: true });
    this.breadcrumb.set(trail);
  }

  backToList(): void {
    this.router.navigate(['/projets', this.projectId, 'pieces', this.ssdgpsId], {
      queryParams: { proprieteId: this.proprieteId, affaireId: this.affaireId, session: this.sessionId },
    });
  }

  onCreated(): void { this.toast.success('Succès', 'Pièce ajoutée'); this.backToList(); }
  onCancelled(): void { this.backToList(); }
}
