import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, Subscription, timer } from 'rxjs';
import { catchError, switchMap, takeWhile } from 'rxjs/operators';
import { AuthService } from '../../../core/auth/auth.service';
import { BreadcrumbService } from '../../../core/layout/services/breadcrumb.service';
import { OrganismeNiveau1, OrganismeNiveau2 } from '../../../core/models/organisme.model';
import { Piece, PieceTypeDef } from '../../../core/models/piece.model';
import {
  Affaire, NATURE_AFFAIRE_LABELS, NatureAffaire, NatureProcedure, NatureSsdgps,
  PROCEDURE_NATURES, PROCEDURE_OPTIONS, PROCEDURES_SANS_DATE_BORNAGE, Projet, Propriete,
  Session, Ssdgps, TypeSsdgps,
} from '../../../core/models/project.model';
import {
  AssistantPayload, ModeleSsdgps, PlanItem, PlanSsdgps,
} from '../../../core/models/modele-ssdgps.model';
import { Organization } from '../../../core/models/organization.model';
import { ModelesSsdgpsService } from '../../../core/services/modeles-ssdgps.service';
import { OrganismeService } from '../../../core/services/organisme.service';
import { OrganizationService } from '../../../core/services/organization.service';
import { PiecesService, RapportCoherence, RapportGeneration } from '../../../core/services/pieces.service';
import { ProjectsService } from '../../../core/services/projects.service';
import { ToastService } from '../../../core/services/toast.service';
import { ProfileService } from '../../profile/services/profile.service';

export type StepKey = 'projet' | 'propriete' | 'affaire' | 'dossier' | 'pieces' | 'rapport';
type Mode = 'existant' | 'nouveau';

/** Formats d'identifiant de propriété — miroir de `projects/validators.py`. */
const REQUISITION_RE = /^R\d{1,6}\/(?:\d{1,4}|[A-Z]{1,2})$/;
const TITRE_RE = /^T\d{1,6}\/(?:\d{1,4}|[A-Z]{1,2})$/;

/** Présentation des 4 natures de SDGPS (cartes de l'étape « Dossier »). */
export const NATURES_PRESENTATION: { value: NatureSsdgps; court: string; titre: string; icon: string }[] = [
  { value: 'PDC/GPS', court: 'PDC', titre: 'Projet de densification cadastrale', icon: 'fa-draw-polygon' },
  { value: 'DDC/GPS', court: 'DDC', titre: 'Dossier de densification cadastrale', icon: 'fa-folder-tree' },
  { value: 'PLC/GPS', court: 'PLC', titre: 'Projet de levé cadastral', icon: 'fa-map-location-dot' },
  { value: 'DLC/GPS', court: 'DLC', titre: 'Dossier de levé cadastral', icon: 'fa-folder-open' },
];

/**
 * Assistant de création d'un SDGPS — UN seul parcours, du projet au rapport livrable.
 *
 * Sans lui, l'opérateur traverse quatre listes (projet, propriété, affaire, SDGPS) avant
 * la première pièce, puis devine pièce après pièce ce que la nature du dossier exige.
 * Ici : les quatre premières étapes décrivent la chaîne (chaque niveau existant ou
 * nouveau) et le MODÈLE de pièces ; la chaîne est créée en une transaction
 * (`POST /ssdgps/assistant/`). Viennent ensuite la liste de contrôle — chaque pièce du
 * modèle s'importe avec l'assistant d'ajout habituel, type pré-sélectionné — puis la
 * validation et la génération du rapport.
 *
 * Reprise : `?ssdgps=<id>&projet=<id>` rouvre un dossier existant à l'étape « Pièces ».
 */
@Component({
  selector: 'app-sdgps-assistant',
  templateUrl: './sdgps-assistant.component.html',
  styleUrls: ['./sdgps-assistant.component.scss'],
})
export class SdgpsAssistantComponent implements OnInit, OnDestroy {
  readonly steps: { key: StepKey; label: string; icon: string; hint: string }[] = [
    { key: 'projet', label: 'Projet', icon: 'fa-diagram-project', hint: 'Existant ou nouveau' },
    { key: 'propriete', label: 'Propriété', icon: 'fa-map-marker-alt', hint: 'Titre ou réquisition' },
    { key: 'affaire', label: 'Affaire', icon: 'fa-file-signature', hint: 'Procédure & nature' },
    { key: 'dossier', label: 'SDGPS & modèle', icon: 'fa-layer-group', hint: 'Nature et pièces' },
    { key: 'pieces', label: 'Pièces', icon: 'fa-paperclip', hint: 'Import & validation' },
    { key: 'rapport', label: 'Rapport', icon: 'fa-file-pdf', hint: 'Génération du livrable' },
  ];
  readonly procedureOptions = PROCEDURE_OPTIONS;
  readonly natures = NATURES_PRESENTATION;

  step: StepKey = 'projet';
  /** Zone qui défile (la barre d'actions, elle, reste hors de cette zone). */
  @ViewChild('scrollArea') scrollArea?: ElementRef<HTMLElement>;
  loading = true;
  creating = false;
  /** Erreur de création renvoyée par le serveur, affichée sur l'étape fautive. */
  stepError: Partial<Record<StepKey, string>> = {};

  // --- Référentiels ---
  catalog: PieceTypeDef[] = [];
  organismesN1: OrganismeNiveau1[] = [];
  organismesN2: OrganismeNiveau2[] = [];
  organizations: Organization[] = [];
  currentOrgId: string | null = null;
  readonly isAppAdmin: boolean;

  // --- Étape Projet ---
  projetMode: Mode = 'existant';
  projets: Projet[] = [];
  projetSearch = '';
  projetId: string | null = null;
  projetNew = { nom_projet: '', code_projet: '', description_projet: '', organization: '' };

  // --- Étape Propriété ---
  proprieteMode: Mode = 'nouveau';
  proprietes: Propriete[] = [];
  proprieteId: string | null = null;
  proprieteNew = { nom_propriete: '', id_titre: '', id_requisition: '', organisme_niveau1: '', organisme_niveau2: '' };

  // --- Étape Affaire ---
  affaireMode: Mode = 'nouveau';
  affaires: Affaire[] = [];
  affaireId: string | null = null;
  affaireNew: { numero_sd_affaire: number | null; nature_procedure_affaire: NatureProcedure | '';
                nature_affaire: NatureAffaire | ''; date_bornage: string } =
    { numero_sd_affaire: 1, nature_procedure_affaire: '', nature_affaire: '', date_bornage: '' };

  // --- Étape Dossier ---
  nature: NatureSsdgps = 'PDC/GPS';
  typeSsdgps: TypeSsdgps = 'mono-session';
  nbSessions = 2;
  modeles: ModeleSsdgps[] = [];
  modeleId: string | null = null;
  previewModeleId: string | null = null;
  editorOpen = false;
  editorModele: ModeleSsdgps | null = null;

  // --- Après création ---
  ssdgps: Ssdgps | null = null;
  createdProjetId: string | null = null;
  createdProprieteId: string | null = null;
  createdAffaireId: string | null = null;
  plan: PlanSsdgps | null = null;
  sessions: Session[] = [];
  pieces: Piece[] = [];
  activeKey: string | null = null;
  /** Ouvre l'assistant d'ajout même si la pièce est déjà importée (autre occurrence). */
  addingAnother = false;
  validating = false;
  validationEchecs: { type_piece: string; numero: number | null; message: string }[] = [];

  // --- Rapport ---
  coherence: RapportCoherence | null = null;
  coherenceLoading = false;
  job: RapportGeneration | null = null;
  reportBlob: Blob | null = null;
  reportName = '';
  submitting = false;
  saveAsModelOpen = false;
  saveAsModelName = '';
  private pollSub: Subscription | null = null;

  constructor(
    private projects: ProjectsService,
    private modelesService: ModelesSsdgpsService,
    private piecesService: PiecesService,
    private organismes: OrganismeService,
    private orgService: OrganizationService,
    private profile: ProfileService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
    private breadcrumb: BreadcrumbService,
    auth: AuthService,
  ) {
    this.isAppAdmin = auth.isPlatformAdmin();
  }

  // =====================================================================================
  // Cycle de vie
  // =====================================================================================

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const resumeId = qp.get('ssdgps');
    const preProjet = qp.get('projet');

    forkJoin({
      catalog: this.piecesService.getCatalog().pipe(catchError(() => of([] as PieceTypeDef[]))),
      projets: this.projects.getProjets({}).pipe(catchError(() => of([] as Projet[]))),
      n1: this.organismes.getNiveau1().pipe(catchError(() => of([] as OrganismeNiveau1[]))),
      n2: this.organismes.getNiveau2().pipe(catchError(() => of([] as OrganismeNiveau2[]))),
      me: this.profile.getCurrentUser().pipe(catchError(() => of(null as any))),
    }).subscribe(({ catalog, projets, n1, n2, me }) => {
      this.catalog = catalog;
      this.projets = projets;
      this.organismesN1 = n1.filter(o => o.is_active !== false);
      this.organismesN2 = n2.filter(o => o.is_active !== false);
      this.currentOrgId = me?.organization_id ?? null;
      if (!this.currentOrgId) {
        this.orgService.getOrganizations().subscribe({ next: o => (this.organizations = o), error: () => {} });
      }
      if (!projets.length) this.projetMode = 'nouveau';
      this.loading = false;

      if (resumeId) {
        this.resume(resumeId, preProjet);
      } else {
        if (preProjet && projets.some(p => p.id === preProjet)) {
          this.selectProjet(preProjet);
          this.step = 'propriete';
        }
        // Démarrage depuis la page des modèles (« Utiliser ») : nature et modèle imposés.
        const preModele = qp.get('modele');
        if (preModele) {
          this.modelesService.get(preModele).subscribe({
            next: m => { this.nature = m.nature_ssdgps; this.loadModeles(m.id); },
            error: () => this.loadModeles(),
          });
        } else {
          this.loadModeles();
        }
      }
      this.updateBreadcrumb();
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.breadcrumb.clear();
  }

  private get base(): string { return this.router.url.startsWith('/admin') ? '/admin/projets' : '/projets'; }

  private updateBreadcrumb(): void {
    this.breadcrumb.set([
      { label: 'Accueil', route: '/home', icon: 'fa-house' },
      { label: 'Projets', route: this.base, icon: 'fa-folder-open' },
      { label: 'Assistant de création SDGPS', icon: 'fa-wand-magic-sparkles', isActive: true },
    ]);
  }

  // =====================================================================================
  // Navigation entre étapes
  // =====================================================================================

  get created(): boolean { return !!this.ssdgps; }
  get stepIndex(): number { return this.steps.findIndex(s => s.key === this.step); }

  /** Une étape est accessible si elle est déjà franchie (avant création) ou, après la
   * création, si c'est une étape post-création — la chaîne créée ne se modifie plus ici. */
  canGoTo(key: StepKey): boolean {
    const i = this.steps.findIndex(s => s.key === key);
    if (this.created) return key === 'pieces' || key === 'rapport';
    if (i >= 4) return false;
    for (let k = 0; k < i; k++) if (!this.stepValid(this.steps[k].key)) return false;
    return true;
  }

  isDone(key: StepKey): boolean {
    const i = this.steps.findIndex(s => s.key === key);
    if (this.created) return i < 4 || (key === 'pieces' && !!this.plan?.pret);
    return i < this.stepIndex && this.stepValid(key);
  }

  goTo(key: StepKey): void {
    if (!this.canGoTo(key)) return;
    this.step = key;
    // Chaque étape repart du haut : sans cela, on arrivait sur la nouvelle étape au
    // niveau de défilement de la précédente.
    this.scrollArea?.nativeElement.scrollTo({ top: 0 });
    if (key === 'rapport') this.runCoherence();
  }

  next(): void {
    if (!this.stepValid(this.step)) return;
    const i = this.stepIndex;
    if (this.step === 'dossier') { this.createDossier(); return; }
    const nextKey = this.steps[i + 1]?.key;
    if (nextKey) this.goTo(nextKey);
  }

  previous(): void {
    const prev = this.steps[this.stepIndex - 1]?.key;
    if (prev && this.canGoTo(prev)) this.goTo(prev);
  }

  /** Ce que dit la barre d'actions : ce qui manque pour continuer, ou que tout est prêt. */
  get footerHint(): { text: string; ok: boolean } | null {
    if (this.created) {
      if (!this.plan || !this.plan.total) return null;
      if (this.step === 'pieces') {
        return this.plan.pret
          ? { text: 'Toutes les pièces sont validées.', ok: true }
          : { text: `${this.plan.validees}/${this.plan.total} pièces validées.`, ok: false };
      }
      return this.reportBlob ? { text: 'Rapport prêt à être livré.', ok: true } : null;
    }
    if (this.stepValid(this.step)) {
      return { text: this.step === 'dossier' ? 'Tout est prêt : le dossier peut être créé.' : 'Étape complète.', ok: true };
    }
    const manque: Record<string, string> = {
      projet: this.projetMode === 'existant' ? 'Choisissez un projet.' : 'Renseignez le nom et le code du projet.',
      propriete: this.proprieteMode === 'existant' ? 'Choisissez une propriété.' : 'Complétez la propriété (identifiant, organismes).',
      affaire: this.affaireMode === 'existant' ? 'Choisissez une affaire.' : 'Complétez l’affaire (procédure, nature, date).',
      dossier: this.modeleId ? 'Nombre de sessions invalide (1 à 50).' : 'Choisissez un modèle de pièces.',
    };
    return { text: manque[this.step] || '', ok: false };
  }

  stepValid(key: StepKey): boolean {
    switch (key) {
      case 'projet':
        return this.projetMode === 'existant'
          ? !!this.projetId
          : !!this.projetNew.nom_projet.trim() && !!this.projetNew.code_projet.trim()
            && (!!this.currentOrgId || !!this.projetNew.organization);
      case 'propriete':
        return this.proprieteMode === 'existant' ? !!this.proprieteId : !this.proprieteErrors().length;
      case 'affaire':
        return this.affaireMode === 'existant' ? !!this.affaireId : !this.affaireErrors().length;
      case 'dossier':
        return !!this.modeleId && (this.typeSsdgps === 'mono-session' || (this.nbSessions >= 1 && this.nbSessions <= 50));
      default:
        return true;
    }
  }

  // =====================================================================================
  // Étape 1 — Projet
  // =====================================================================================

  get filteredProjets(): Projet[] {
    const q = this.projetSearch.trim().toLowerCase();
    if (!q) return this.projets;
    return this.projets.filter(p =>
      `${p.nom_projet} ${p.code_projet} ${p.organization_name || ''}`.toLowerCase().includes(q));
  }

  setProjetMode(m: Mode): void {
    this.projetMode = m;
    this.resetBelowProjet();
    if (m === 'nouveau') this.projetId = null;
  }

  selectProjet(id: string): void {
    if (this.projetId === id) return;
    this.projetId = id;
    this.resetBelowProjet();
    this.projects.getProprietes(id).subscribe({
      next: list => { this.proprietes = list; this.proprieteMode = list.length ? 'existant' : 'nouveau'; },
      error: () => { this.proprietes = []; },
    });
  }

  /** Code projet proposé : préfixe du nom + date + suffixe aléatoire court. */
  suggestCode(): void {
    const prefix = (this.projetNew.nom_projet || 'PRJ').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'PRJ';
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    this.projetNew.code_projet = `${prefix}-${date}-${rand}`;
  }

  private resetBelowProjet(): void {
    this.proprietes = []; this.proprieteId = null; this.proprieteMode = 'nouveau';
    this.resetBelowPropriete();
  }

  // =====================================================================================
  // Étape 2 — Propriété
  // =====================================================================================

  get organismesN2Filtres(): OrganismeNiveau2[] {
    const n1 = this.proprieteNew.organisme_niveau1;
    return n1 ? this.organismesN2.filter(o => o.niveau1 === n1) : [];
  }

  onOrganismeN1Change(): void {
    const ok = this.organismesN2Filtres.some(o => o.id === this.proprieteNew.organisme_niveau2);
    if (!ok) this.proprieteNew.organisme_niveau2 = this.organismesN2Filtres.length === 1 ? this.organismesN2Filtres[0].id : '';
  }

  /** Contrôles de surface — le serveur reste juge (mêmes règles côté sérialiseur). */
  proprieteErrors(): string[] {
    const p = this.proprieteNew; const e: string[] = [];
    if (!p.nom_propriete.trim()) e.push('nom');
    if (!p.id_titre.trim() && !p.id_requisition.trim()) e.push('identifiant');
    if (p.id_titre.trim() && !TITRE_RE.test(p.id_titre.trim())) e.push('titre');
    if (p.id_requisition.trim() && !REQUISITION_RE.test(p.id_requisition.trim())) e.push('requisition');
    if (!p.organisme_niveau1) e.push('n1');
    if (!p.organisme_niveau2) e.push('n2');
    return e;
  }
  hasError(list: string[], key: string): boolean { return list.includes(key); }

  setProprieteMode(m: Mode): void { this.proprieteMode = m; this.proprieteId = null; this.resetBelowPropriete(); }

  selectPropriete(id: string): void {
    if (this.proprieteId === id) return;
    this.proprieteId = id;
    this.resetBelowPropriete();
    this.projects.getAffaires(id).subscribe({
      next: list => {
        this.affaires = list; this.affaireMode = list.length ? 'existant' : 'nouveau';
        this.affaireNew.numero_sd_affaire = Math.max(0, ...list.map(a => a.numero_sd_affaire)) + 1;
      },
      error: () => { this.affaires = []; },
    });
  }

  proprieteLabel(p: Propriete): string { return p.id_titre || p.id_requisition || p.nom_propriete; }

  private resetBelowPropriete(): void {
    this.affaires = []; this.affaireId = null; this.affaireMode = 'nouveau';
    this.affaireNew.numero_sd_affaire = 1;
  }

  // =====================================================================================
  // Étape 3 — Affaire
  // =====================================================================================

  get natureAffaireOptions(): { value: NatureAffaire; label: string }[] {
    const proc = this.affaireNew.nature_procedure_affaire;
    if (!proc) return [];
    return (PROCEDURE_NATURES[proc] || []).map(n => ({ value: n, label: `${n} — ${NATURE_AFFAIRE_LABELS[n]}` }));
  }

  get dateBornageRequise(): boolean {
    const proc = this.affaireNew.nature_procedure_affaire;
    return !!proc && !PROCEDURES_SANS_DATE_BORNAGE.includes(proc);
  }

  onProcedureChange(): void {
    const opts = this.natureAffaireOptions;
    if (!opts.some(o => o.value === this.affaireNew.nature_affaire)) {
      this.affaireNew.nature_affaire = opts.length === 1 ? opts[0].value : '';
    }
    if (!this.dateBornageRequise) this.affaireNew.date_bornage = '';
  }

  affaireErrors(): string[] {
    const a = this.affaireNew; const e: string[] = [];
    if (!a.numero_sd_affaire || a.numero_sd_affaire < 1) e.push('numero');
    if (this.affaireMode === 'nouveau' && this.affaires.some(x => x.numero_sd_affaire === a.numero_sd_affaire)) e.push('numero_pris');
    if (!a.nature_procedure_affaire) e.push('procedure');
    if (!a.nature_affaire) e.push('nature');
    if (this.dateBornageRequise && !a.date_bornage) e.push('date');
    return e;
  }

  setAffaireMode(m: Mode): void { this.affaireMode = m; this.affaireId = null; }
  selectAffaire(id: string): void { this.affaireId = id; }
  natureAffaireLabel(v: string): string { return NATURE_AFFAIRE_LABELS[v as NatureAffaire] || v; }

  // =====================================================================================
  // Étape 4 — SDGPS & modèle
  // =====================================================================================

  setNature(n: NatureSsdgps): void {
    if (this.nature === n) return;
    this.nature = n;
    this.loadModeles();
  }

  loadModeles(selectId?: string): void {
    this.modelesService.list(this.nature).subscribe({
      next: list => {
        this.modeles = list;
        const keep = selectId || this.modeleId;
        const found = list.find(m => m.id === keep);
        // Par défaut, le modèle de l'application de la nature : le choix le plus sûr.
        const chosen = found || list.find(m => m.portee === 'systeme') || list[0] || null;
        this.selectModele(chosen);
      },
      error: () => { this.modeles = []; this.modeleId = null; },
    });
  }

  get modelesSysteme(): ModeleSsdgps[] { return this.modeles.filter(m => m.portee === 'systeme'); }
  get modelesPersonnels(): ModeleSsdgps[] { return this.modeles.filter(m => m.portee === 'personnel'); }
  get selectedModele(): ModeleSsdgps | null { return this.modeles.find(m => m.id === this.modeleId) || null; }
  get previewModele(): ModeleSsdgps | null {
    return this.modeles.find(m => m.id === this.previewModeleId) || this.selectedModele;
  }

  selectModele(m: ModeleSsdgps | null): void {
    this.modeleId = m?.id ?? null;
    this.previewModeleId = m?.id ?? null;
    if (m) this.typeSsdgps = m.type_ssdgps;
  }

  openEditor(m: ModeleSsdgps | null = null): void { this.editorModele = m; this.editorOpen = true; }
  closeEditor(): void { this.editorOpen = false; this.editorModele = null; }

  onModeleSaved(m: ModeleSsdgps): void {
    this.closeEditor();
    if (m.nature_ssdgps !== this.nature) this.nature = m.nature_ssdgps;
    this.loadModeles(m.id);
  }

  /** « Adapter » un modèle de l'application = en faire une copie personnelle, puis l'éditer. */
  adaptModele(m: ModeleSsdgps): void {
    this.modelesService.duplicate(m.id, `${m.nom} — personnalisé`).subscribe({
      next: copie => { this.modeles = [...this.modeles, copie]; this.selectModele(copie); this.openEditor(copie); },
      error: () => this.toast.error('Erreur', 'Duplication du modèle impossible'),
    });
  }

  deleteModele(m: ModeleSsdgps): void {
    if (!m.modifiable || !confirm(`Supprimer le modèle « ${m.nom} » ?`)) return;
    this.modelesService.delete(m.id).subscribe({
      next: () => { this.toast.success('Modèle supprimé', m.nom); if (this.modeleId === m.id) this.modeleId = null; this.loadModeles(); },
      error: () => this.toast.error('Erreur', 'Suppression impossible'),
    });
  }

  sourceIcon(source: string | undefined): string {
    if (!source) return 'fa-table';
    if (source.startsWith('image')) return 'fa-image';
    if (source === 'calcul') return 'fa-calculator';
    return 'fa-table';
  }

  // --- Récapitulatif (colonne de droite des étapes 1 à 4) ---

  get recapProjet(): string {
    if (this.projetMode === 'existant') {
      const p = this.projets.find(x => x.id === this.projetId);
      return p ? `${p.nom_projet}` : '';
    }
    return this.projetNew.nom_projet.trim();
  }
  get recapPropriete(): string {
    if (this.proprieteMode === 'existant') {
      const p = this.proprietes.find(x => x.id === this.proprieteId);
      return p ? this.proprieteLabel(p) : '';
    }
    return this.proprieteNew.id_titre.trim() || this.proprieteNew.id_requisition.trim();
  }
  get recapAffaire(): string {
    if (this.affaireMode === 'existant') {
      const a = this.affaires.find(x => x.id === this.affaireId);
      return a ? `SD ${a.numero_sd_affaire} — ${a.nature_affaire}` : '';
    }
    const a = this.affaireNew;
    return a.numero_sd_affaire && a.nature_affaire ? `SD ${a.numero_sd_affaire} — ${a.nature_affaire}` : '';
  }

  // =====================================================================================
  // Création (transaction serveur)
  // =====================================================================================

  buildPayload(): AssistantPayload {
    const projet = this.projetMode === 'existant'
      ? { id: this.projetId! }
      : { nouveau: {
          nom_projet: this.projetNew.nom_projet.trim(), code_projet: this.projetNew.code_projet.trim(),
          description_projet: this.projetNew.description_projet.trim(),
          ...(this.currentOrgId ? {} : { organization: this.projetNew.organization }),
        } };
    const propriete = this.proprieteMode === 'existant'
      ? { id: this.proprieteId! }
      : { nouveau: {
          nom_propriete: this.proprieteNew.nom_propriete.trim(),
          id_titre: this.proprieteNew.id_titre.trim(), id_requisition: this.proprieteNew.id_requisition.trim(),
          organisme_niveau1: this.proprieteNew.organisme_niveau1, organisme_niveau2: this.proprieteNew.organisme_niveau2,
        } };
    const a = this.affaireNew;
    const affaire = this.affaireMode === 'existant'
      ? { id: this.affaireId! }
      : { nouveau: {
          numero_sd_affaire: a.numero_sd_affaire, nature_procedure_affaire: a.nature_procedure_affaire,
          nature_affaire: a.nature_affaire,
          date_bornage: this.dateBornageRequise && a.date_bornage ? new Date(a.date_bornage).toISOString() : null,
        } };
    const payload: AssistantPayload = {
      projet, propriete, affaire,
      ssdgps: { nature_ssdgps: this.nature, type_ssdgps: this.typeSsdgps },
      modele: this.modeleId,
    };
    if (this.typeSsdgps === 'multi-session') payload.nb_sessions = this.nbSessions;
    return payload;
  }

  createDossier(): void {
    if (this.creating || !this.stepValid('dossier')) return;
    this.creating = true; this.stepError = {};
    this.modelesService.createDossier(this.buildPayload()).subscribe({
      next: res => {
        this.creating = false;
        this.ssdgps = res.ssdgps;
        this.createdProjetId = res.projet; this.createdProprieteId = res.propriete; this.createdAffaireId = res.affaire;
        this.plan = res.plan;
        this.toast.success('Dossier créé', `SSDGPS n°${res.ssdgps.numero_ssdgps} (${res.ssdgps.nature_ssdgps}) prêt à recevoir ses pièces.`);
        this.loadDossierContext(() => this.selectNextToImport());
        this.step = 'pieces';
        // L'URL devient celle d'une reprise : recharger la page ne recrée rien.
        this.router.navigate([], { relativeTo: this.route, replaceUrl: true,
          queryParams: { ssdgps: res.ssdgps.id, projet: res.projet } });
      },
      error: err => {
        this.creating = false;
        this.handleCreateError(err?.error || {});
      },
    });
  }

  /** Range l'erreur serveur sous l'étape fautive et y ramène l'opérateur. */
  handleCreateError(body: any): void {
    const map: Record<string, StepKey> = {
      projet: 'projet', propriete: 'propriete', affaire: 'affaire',
      ssdgps: 'dossier', modele: 'dossier', nb_sessions: 'dossier',
    };
    const flatten = (v: any): string => {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join(' ');
      return Object.entries(v).map(([k, x]) => `${k === 'non_field_errors' ? '' : k + ' : '}${flatten(x)}`).join(' · ');
    };
    const key = Object.keys(body).find(k => k in map);
    if (key) {
      this.stepError = { [map[key]]: flatten(body[key]) };
      this.step = map[key];
    } else {
      this.stepError = { [this.step]: body.detail || 'Création impossible.' };
    }
    this.toast.error('Création impossible', 'Corrigez l’étape signalée.');
  }

  // =====================================================================================
  // Reprise d'un dossier existant
  // =====================================================================================

  private resume(ssdgpsId: string, projetId: string | null): void {
    this.loading = true;
    this.projects.getSsdgpsById(ssdgpsId).subscribe({
      next: s => {
        this.ssdgps = s;
        this.nature = s.nature_ssdgps;
        this.createdProjetId = projetId;
        this.createdProprieteId = s.propriete || null;
        this.createdAffaireId = s.affaire;
        this.step = 'pieces';
        this.loading = false;
        this.loadModeles();
        this.loadDossierContext(() => this.selectNextToImport());
      },
      error: () => { this.loading = false; this.toast.error('Erreur', 'Dossier introuvable'); this.router.navigate([this.base]); },
    });
  }

  /** (Re)charge plan, sessions et pièces du dossier — après chaque import ou validation. */
  loadDossierContext(after?: () => void): void {
    if (!this.ssdgps) return;
    const id = this.ssdgps.id;
    forkJoin({
      plan: this.modelesService.getPlan(id),
      sessions: this.projects.getSessions(id).pipe(catchError(() => of([] as Session[]))),
      pieces: this.piecesService.listBySsdgps(id, false).pipe(catchError(() => of([] as Piece[]))),
      ssdgps: this.projects.getSsdgpsById(id).pipe(catchError(() => of(this.ssdgps))),
    }).subscribe({
      next: ({ plan, sessions, pieces, ssdgps }) => {
        this.plan = plan; this.sessions = sessions; this.pieces = pieces;
        if (ssdgps) this.ssdgps = ssdgps;
        after?.();
      },
      error: () => this.toast.error('Erreur', 'Chargement du dossier impossible'),
    });
  }

  /** Un dossier sans modèle (créé hors assistant) reçoit sa liste de contrôle ici. */
  applyModele(): void {
    if (!this.ssdgps || !this.modeleId) return;
    this.modelesService.applyModele(this.ssdgps.id, this.modeleId).subscribe({
      next: plan => { this.plan = plan; this.selectNextToImport(); this.toast.success('Modèle appliqué', plan.modele_nom); },
      error: err => this.toast.error('Erreur', err?.error?.detail || 'Application du modèle impossible'),
    });
  }

  // =====================================================================================
  // Étape 5 — Pièces
  // =====================================================================================

  itemKey(i: PlanItem): string { return `${i.type_piece}#${i.numero ?? ''}`; }
  get activeItem(): PlanItem | null { return this.plan?.items.find(i => this.itemKey(i) === this.activeKey) || null; }
  get locked(): boolean { return !!this.ssdgps?.verrouille; }

  /** Le parcours d'ajout n'est montré que pour une pièce à importer, ou sur demande
   * explicite (autre occurrence d'une pièce déjà présente, p. ex. une autre session). */
  get showWizard(): boolean {
    const it = this.activeItem;
    return !!it && !this.locked && (it.etat === 'a_importer' || this.addingAnother);
  }

  get progressImport(): number { return this.plan?.total ? Math.round(100 * this.plan.importees / this.plan.total) : 0; }
  get progressValid(): number { return this.plan?.total ? Math.round(100 * this.plan.validees / this.plan.total) : 0; }

  selectItem(i: PlanItem): void { this.activeKey = this.itemKey(i); this.addingAnother = false; }

  selectNextToImport(): void {
    const next = this.plan?.items.find(i => i.etat === 'a_importer');
    this.activeKey = next ? this.itemKey(next) : null;
    this.addingAnother = false;
  }

  onPieceCreated(): void {
    this.toast.success('Pièce importée', this.activeItem?.nom || '');
    this.loadDossierContext(() => this.selectNextToImport());
  }

  onWizardCancelled(): void { this.addingAnother = false; if (this.activeItem?.etat === 'a_importer') this.activeKey = null; }

  etatLabel(etat: string): string {
    return ({ a_importer: 'À importer', brouillon: 'À valider', rejete: 'Rejetée', valide: 'Validée' } as any)[etat] || etat;
  }
  etatIcon(etat: string): string {
    return ({ a_importer: 'fa-cloud-arrow-up', brouillon: 'fa-hourglass-half', rejete: 'fa-circle-xmark', valide: 'fa-circle-check' } as any)[etat] || 'fa-circle';
  }

  validate(ids?: string[]): void {
    if (!this.ssdgps || this.validating) return;
    this.validating = true; this.validationEchecs = [];
    this.modelesService.validatePieces(this.ssdgps.id, ids).subscribe({
      next: res => {
        this.validating = false;
        this.plan = res.plan;
        this.validationEchecs = res.echecs;
        if (res.validees) this.toast.success('Validation', `${res.validees} pièce(s) validée(s).`);
        if (res.echecs.length) this.toast.warning('Validation partielle', `${res.echecs.length} pièce(s) n'ont pas pu être validées.`);
        this.piecesService.listBySsdgps(this.ssdgps!.id, false).subscribe(p => (this.pieces = p));
      },
      error: err => { this.validating = false; this.toast.error('Erreur', err?.error?.detail || 'Validation impossible'); },
    });
  }

  validateItem(i: PlanItem): void { this.validate(i.pieces.filter(p => p.statut !== 'valide').map(p => p.id)); }

  openPiece(pieceId: string): void {
    if (!this.ssdgps || !this.createdProjetId) return;
    this.router.navigate([this.base, this.createdProjetId, 'pieces', this.ssdgps.id, 'piece', pieceId]);
  }

  openDossier(): void {
    if (!this.ssdgps || !this.createdProjetId) return;
    this.router.navigate([this.base, this.createdProjetId, 'pieces', this.ssdgps.id], {
      queryParams: { proprieteId: this.createdProprieteId, affaireId: this.createdAffaireId },
    });
  }

  // =====================================================================================
  // Étape 6 — Rapport
  // =====================================================================================

  runCoherence(): void {
    if (!this.ssdgps) return;
    this.coherenceLoading = true;
    this.piecesService.checkReportCoherence(this.ssdgps.id).subscribe({
      next: c => { this.coherence = c; this.coherenceLoading = false; },
      // Un contrôle en échec n'empêche jamais de générer : on n'affiche simplement rien.
      error: () => { this.coherence = null; this.coherenceLoading = false; },
    });
  }

  get generating(): boolean { return !!this.job && (this.job.statut === 'en_attente' || this.job.statut === 'en_cours'); }

  generate(): void {
    if (!this.ssdgps || this.generating) return;
    this.reportBlob = null;
    this.piecesService.startReport(this.ssdgps.id).subscribe({
      next: job => { this.job = job; this.poll(job.id); },
      error: err => this.toast.error('Génération impossible', err?.error?.detail || 'Erreur serveur'),
    });
  }

  private poll(id: string): void {
    this.pollSub?.unsubscribe();
    if (this.job?.statut === 'termine') { this.fetchReport(id); return; }
    this.pollSub = timer(1500, 1500).pipe(
      switchMap(() => this.piecesService.getReportJob(id)),
      takeWhile(j => j.statut === 'en_attente' || j.statut === 'en_cours', true),
    ).subscribe({
      next: j => {
        this.job = j;
        if (j.statut === 'termine') this.fetchReport(id);
        if (j.statut === 'echec') this.toast.error('Échec de la génération', j.erreur || '');
      },
      error: () => this.toast.error('Erreur', 'Suivi de la génération interrompu'),
    });
  }

  private fetchReport(id: string): void {
    this.piecesService.getReportFile(id).subscribe({
      next: res => {
        const bin = atob(res.data); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        this.reportBlob = new Blob([bytes], { type: res.content_type || 'application/pdf' });
        this.reportName = res.filename || 'rapport.pdf';
        this.toast.success('Rapport prêt', this.reportName);
      },
      error: () => this.toast.error('Erreur', 'Téléchargement du rapport impossible'),
    });
  }

  download(): void {
    if (!this.reportBlob) return;
    const url = URL.createObjectURL(this.reportBlob);
    const a = document.createElement('a');
    a.href = url; a.download = this.reportName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  get canSubmit(): boolean { return !!this.ssdgps?.transitions?.includes('soumettre') && !!this.plan?.pret; }

  submitDossier(): void {
    if (!this.ssdgps || !this.canSubmit || this.submitting) return;
    this.submitting = true;
    this.projects.transitionSsdgps(this.ssdgps.id, 'soumettre').subscribe({
      next: s => { this.submitting = false; this.ssdgps = s; this.toast.success('Dossier soumis', 'Il est désormais figé jusqu’à la décision de l’encadrement.'); },
      error: err => { this.submitting = false; this.toast.error('Soumission impossible', err?.error?.detail || ''); },
    });
  }

  openSaveAsModel(): void {
    this.saveAsModelName = this.ssdgps ? `Modèle ${this.ssdgps.nature_ssdgps.replace('/GPS', '')} — SSDGPS n°${this.ssdgps.numero_ssdgps}` : '';
    this.saveAsModelOpen = true;
  }

  saveAsModel(): void {
    if (!this.ssdgps || !this.saveAsModelName.trim()) return;
    this.modelesService.fromSsdgps(this.ssdgps.id, this.saveAsModelName.trim()).subscribe({
      next: m => { this.saveAsModelOpen = false; this.toast.success('Modèle enregistré', `« ${m.nom} » est disponible dans vos modèles.`); },
      error: err => this.toast.error('Erreur', err?.error?.detail || 'Enregistrement impossible'),
    });
  }

  restart(): void {
    // Repartir d'un état vierge : un rechargement complet est plus sûr qu'une remise à zéro
    // champ par champ (référentiels, abonnements de suivi, fil d'Ariane).
    window.location.assign(`${this.base}/assistant`);
  }
}
