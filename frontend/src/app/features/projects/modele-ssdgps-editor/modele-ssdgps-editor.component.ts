import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { PieceTypeDef } from '../../../core/models/piece.model';
import { ModelePiece, ModeleSsdgps, PorteeModele } from '../../../core/models/modele-ssdgps.model';
import { NATURE_SSDGPS_OPTIONS, NatureSsdgps, TypeSsdgps } from '../../../core/models/project.model';
import { ModelesSsdgpsService } from '../../../core/services/modeles-ssdgps.service';
import { ToastService } from '../../../core/services/toast.service';

/** Types qu'un modèle peut réclamer pour une nature : applicables, hors pièces générées. */
export function typesApplicables(catalog: PieceTypeDef[], nature: string): PieceTypeDef[] {
  return catalog.filter(d =>
    d.source !== 'ui' && (d.natures === 'toutes' || (d.natures as string[]).includes(nature)));
}

/** Pièces par défaut d'une nature — même règle que le backend (`pieces_par_defaut`). */
export function piecesParDefaut(catalog: PieceTypeDef[], nature: string): ModelePiece[] {
  return typesApplicables(catalog, nature).map(d => ({
    type_piece: d.code, numero: d.repeatable ? 1 : null, obligatoire: true,
  }));
}

/**
 * Éditeur d'un modèle de SDGPS, en modale : identité (nom, nature, type), puis
 * composition — catalogue des pièces applicables à gauche, pièces du modèle (ordonnées,
 * obligatoires ou facultatives) à droite. Utilisé par la page « Modèles de SDGPS » et,
 * en ligne, par l'assistant de création (« Créer un modèle personnalisé »).
 */
@Component({
  selector: 'app-modele-ssdgps-editor',
  templateUrl: './modele-ssdgps-editor.component.html',
  styleUrls: ['./modele-ssdgps-editor.component.scss'],
})
export class ModeleSsdgpsEditorComponent implements OnInit {
  /** Modèle à modifier ; `null` = création. */
  @Input() modele: ModeleSsdgps | null = null;
  @Input() catalog: PieceTypeDef[] = [];
  /** Nature pré-sélectionnée à la création (celle du dossier en cours dans l'assistant). */
  @Input() defaultNature: NatureSsdgps = 'PDC/GPS';
  /** L'appelant relève-t-il de l'administration de l'application (modèle partagé) ? */
  @Input() canCreateSystem = false;
  @Output() saved = new EventEmitter<ModeleSsdgps>();
  @Output() closed = new EventEmitter<void>();

  readonly natureOptions = NATURE_SSDGPS_OPTIONS;

  nom = '';
  description = '';
  nature: NatureSsdgps = 'PDC/GPS';
  typeSsdgps: TypeSsdgps = 'mono-session';
  portee: PorteeModele = 'personnel';
  pieces: ModelePiece[] = [];
  saving = false;
  error = '';
  /** Pièces écartées au dernier changement de nature (information, pas une erreur). */
  dropped: string[] = [];

  constructor(private service: ModelesSsdgpsService, private toast: ToastService) {}

  get isNew(): boolean { return !this.modele; }

  ngOnInit(): void {
    if (this.modele) {
      this.nom = this.modele.nom;
      this.description = this.modele.description || '';
      this.nature = this.modele.nature_ssdgps;
      this.typeSsdgps = this.modele.type_ssdgps;
      this.portee = this.modele.portee;
      this.pieces = (this.modele.pieces || []).map(p => ({ ...p }));
    } else {
      this.nature = this.defaultNature;
      this.pieces = piecesParDefaut(this.catalog, this.nature);
    }
  }

  // --- Catalogue ----------------------------------------------------------------------

  def(code: string): PieceTypeDef | undefined { return this.catalog.find(d => d.code === code); }

  label(p: ModelePiece): string {
    const nom = this.def(p.type_piece)?.nom || p.type_piece;
    return p.numero ? nom.replace('N°k', `N°${p.numero}`) : nom;
  }

  /** Types encore ajoutables : non présents (un répétable reste toujours ajoutable). */
  get available(): PieceTypeDef[] {
    const present = new Set(this.pieces.map(p => p.type_piece));
    return typesApplicables(this.catalog, this.nature).filter(d => d.repeatable || !present.has(d.code));
  }

  sourceIcon(code: string): string {
    const src = this.def(code)?.source || '';
    if (src.startsWith('image')) return 'fa-image';
    if (src === 'calcul') return 'fa-calculator';
    return 'fa-table';
  }

  add(d: PieceTypeDef): void {
    const numero = d.repeatable
      ? Math.max(0, ...this.pieces.filter(p => p.type_piece === d.code).map(p => p.numero || 0)) + 1
      : null;
    // Insertion à la position du catalogue (l'ordre du rapport) plutôt qu'en fin de liste.
    const rank = (code: string) => this.catalog.findIndex(c => c.code === code);
    let at = this.pieces.findIndex(p => rank(p.type_piece) > rank(d.code));
    if (at < 0) at = this.pieces.length;
    this.pieces.splice(at, 0, { type_piece: d.code, numero, obligatoire: true });
  }

  remove(i: number): void { this.pieces.splice(i, 1); }

  move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.pieces.length) return;
    [this.pieces[i], this.pieces[j]] = [this.pieces[j], this.pieces[i]];
  }

  toggleObligatoire(p: ModelePiece): void { p.obligatoire = !p.obligatoire; }

  resetDefaults(): void { this.pieces = piecesParDefaut(this.catalog, this.nature); this.dropped = []; }

  /** Changer de nature écarte les pièces qui ne s'y appliquent pas — en le disant. */
  setNature(n: NatureSsdgps): void {
    if (n === this.nature) return;
    this.nature = n;
    const ok = new Set<string>(typesApplicables(this.catalog, n).map(d => d.code));
    this.dropped = this.pieces.filter(p => !ok.has(p.type_piece)).map(p => p.type_piece);
    this.pieces = this.pieces.filter(p => ok.has(p.type_piece));
    if (!this.pieces.length) this.pieces = piecesParDefaut(this.catalog, n);
  }

  get obligatoires(): number { return this.pieces.filter(p => p.obligatoire).length; }

  get canSave(): boolean { return !!this.nom.trim() && this.pieces.length > 0 && !this.saving; }

  save(): void {
    if (!this.canSave) return;
    this.saving = true; this.error = '';
    const payload: Partial<ModeleSsdgps> = {
      nom: this.nom.trim(), description: this.description.trim(),
      nature_ssdgps: this.nature, type_ssdgps: this.typeSsdgps,
      pieces: this.pieces.map(({ type_piece, numero, obligatoire }) => ({ type_piece, numero, obligatoire })),
    };
    if (this.isNew) payload.portee = this.portee;
    const req = this.modele ? this.service.update(this.modele.id, payload) : this.service.create(payload);
    req.subscribe({
      next: m => {
        this.saving = false;
        this.toast.success('Modèle enregistré', `« ${m.nom} » est prêt à l'emploi.`);
        this.saved.emit(m);
      },
      error: err => {
        this.saving = false;
        const e = err?.error || {};
        this.error = [e.detail, e.nom, e.pieces, e.portee].flat().filter(Boolean).join(' ')
          || "Enregistrement impossible.";
      },
    });
  }
}
