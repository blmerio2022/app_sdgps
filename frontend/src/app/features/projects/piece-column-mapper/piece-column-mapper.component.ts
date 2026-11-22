import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { PieceChampDef, PieceImportPreview } from '../../../core/models/piece.model';
import { IaConfiance } from '../../../core/models/ia.model';
import { IaService, messageErreurIa } from '../../../core/services/ia.service';

const IGNORE = '';

/**
 * UI de mapping flexible colonnes (fichier importé) → champs cibles (catalogue de la pièce).
 * Un menu déroulant par champ cible, avec auto-suggestion initiale par correspondance de nom.
 */
@Component({
  selector: 'app-piece-column-mapper',
  templateUrl: './piece-column-mapper.component.html',
  styleUrls: ['./piece-column-mapper.component.scss'],
})
export class PieceColumnMapperComponent implements OnChanges, OnInit {
  @Input() champs: PieceChampDef[] = [];
  @Input() preview!: PieceImportPreview;
  /** Code du type de pièce : requis pour la proposition par l'IA (champs du catalogue). */
  @Input() typePiece: string | null = null;
  /** Correspondance proposée par le SERVEUR (libellés + synonymes des exports réels :
   * « Abscisse », « ID du point »…). Fait référence pour « Réinitialiser » ; à défaut, la
   * correspondance par nom faite ici. */
  @Input() mappingPropose: Record<string, string> | null = null;
  /** Correspondance de départ, quand elle diffère de la proposition (import en masse :
   * choix déjà ajusté par l'opérateur). */
  @Input() mappingInitial: Record<string, string> | null = null;
  @Output() mappingChange = new EventEmitter<Record<string, string>>();

  /** N°4 — Correspondance proposée par l'IA (masquée si l'IA n'est pas activée). */
  iaDisponible = false;
  iaEnCours = false;
  iaMessage = '';
  iaErreur = '';
  /** Associations posées par l'IA, avec confiance et raison — badge sur la ligne tant que
   * l'opérateur ne l'a pas changée. */
  iaSuggestions: Record<string, { colonne: string; confiance: IaConfiance; raison: string }> = {};

  readonly ignoreValue = IGNORE;
  form: FormGroup;
  private originalSuggestions: Record<string, string> = {};

  constructor(private fb: FormBuilder, private ia: IaService) {
    this.form = this.fb.group({});
  }

  ngOnInit(): void {
    this.ia.disponible$.subscribe(d => (this.iaDisponible = d));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['champs'] || changes['preview'] || changes['mappingPropose'] || changes['mappingInitial']) {
      this.buildForm();
    }
  }

  private normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }

  /**
   * Auto-suggestion en DEUX passes, chaque colonne source réservée au plus une fois :
   *  1. correspondance EXACTE (libellé ou nom normalisé) ;
   *  2. correspondance APPROCHÉE (inclusion) sur les colonnes restantes.
   * L'exact-d'abord + réservation évite qu'un champ récupère par inclusion la colonne
   * d'un autre (ex. « Réf. antenne » ⊃ « Antenne » → sinon `ref_antenne` volait « Antenne »).
   */
  private buildForm(): void {
    this.iaSuggestions = {};
    this.iaMessage = '';
    this.iaErreur = '';
    const group: Record<string, any> = {};
    this.originalSuggestions = {};
    const cols = (this.preview?.columns || []).map(raw => ({ raw, norm: this.normalize(raw) }));
    const used = new Set<string>();

    const claim = (champ: PieceChampDef, predicate: (c: { raw: string; norm: string }) => boolean): boolean => {
      const m = cols.find(c => !used.has(c.raw) && predicate(c));
      if (m) { used.add(m.raw); this.originalSuggestions[champ.name] = m.raw; return true; }
      return false;
    };

    // Passe 0 : proposition du serveur (synonymes), quand elle désigne une colonne existante.
    const propose = this.mappingPropose || {};
    const restants: PieceChampDef[] = [];
    for (const champ of this.champs) {
      const col = propose[champ.name];
      if (!claim(champ, c => !!col && c.raw === col)) restants.push(champ);
    }
    // Passe 1 : exacte
    const pending: PieceChampDef[] = [];
    for (const champ of restants) {
      const tl = this.normalize(champ.label), tn = this.normalize(champ.name);
      if (!claim(champ, c => c.norm === tl || c.norm === tn)) pending.push(champ);
    }
    // Passe 2 : approchée (inclusion) sur les colonnes non déjà prises
    for (const champ of pending) {
      const tl = this.normalize(champ.label), tn = this.normalize(champ.name);
      if (!claim(champ, c => c.norm.includes(tn) || c.norm.includes(tl) || tl.includes(c.norm))) {
        this.originalSuggestions[champ.name] = IGNORE;
      }
    }

    const initial = this.mappingInitial;
    for (const champ of this.champs) {
      const depart = initial
        ? (initial[champ.name] && this.preview?.columns?.includes(initial[champ.name]) ? initial[champ.name] : IGNORE)
        : this.originalSuggestions[champ.name];
      group[champ.name] = [depart ?? IGNORE];
    }
    this.form = this.fb.group(group);
    this.form.valueChanges.subscribe(() => this.emitMapping());
    this.emitMapping();
  }

  /** Le champ a-t-il été modifié par rapport à la suggestion automatique initiale ? */
  isModified(champName: string): boolean {
    return this.form.value[champName] !== this.originalSuggestions[champName];
  }

  resetField(champName: string): void {
    this.form.get(champName)?.setValue(this.originalSuggestions[champName]);
  }

  resetAllToSuggestions(): void {
    this.form.patchValue(this.originalSuggestions);
  }

  /** Champs encore sans colonne ET colonnes encore libres : l'IA a-t-elle de quoi compléter ? */
  get peutCompleterAvecIa(): boolean {
    return !!this.typePiece && this.mappedCount < this.totalChamps
      && this.unmappedSourceColumns.length > 0;
  }

  /**
   * Demande à l'IA de COMPLÉTER la correspondance : les champs déjà associés restent tels
   * quels (le serveur ne les propose même pas), seules les associations manquantes sont
   * posées — chacune marquée d'un badge de confiance, à vérifier par l'opérateur.
   */
  completerAvecIa(): void {
    if (!this.peutCompleterAvecIa || this.iaEnCours) return;
    this.iaEnCours = true;
    this.iaMessage = '';
    this.iaErreur = '';
    const deja: Record<string, string> = {};
    Object.entries(this.form.value).forEach(([c, col]) => { if (col) deja[c] = col as string; });
    this.ia.mappingColonnes(this.typePiece!, this.preview.columns, this.previewSampleRows, deja)
      .subscribe({
        next: ({ propositions }) => {
          this.iaEnCours = false;
          let posees = 0;
          for (const p of propositions || []) {
            const ctrl = this.form.get(p.champ);
            if (!ctrl || ctrl.value) continue;          // jamais par-dessus un choix existant
            if (!this.preview.columns.includes(p.colonne)) continue;
            this.iaSuggestions[p.champ] = { colonne: p.colonne, confiance: p.confiance, raison: p.raison };
            ctrl.setValue(p.colonne);
            posees++;
          }
          this.iaMessage = posees
            ? `${posees} association(s) proposée(s) par l'IA — vérifiez-les avant d'importer.`
            : "L'IA n'a trouvé aucune association sûre à ajouter.";
        },
        error: (err) => { this.iaEnCours = false; this.iaErreur = messageErreurIa(err); },
      });
  }

  /** Badge IA d'un champ, tant que sa valeur est encore celle proposée. */
  suggestionIa(champName: string) {
    const s = this.iaSuggestions[champName];
    return s && this.form.value[champName] === s.colonne ? s : null;
  }

  titreSuggestion(raison: string): string {
    return `Proposé par l'IA — ${raison}`;
  }

  libelleConfiance(c: IaConfiance): string {
    return c === 'haute' ? 'sûre' : c === 'moyenne' ? 'probable' : 'à vérifier';
  }

  private emitMapping(): void {
    const mapping: Record<string, string> = {};
    Object.entries(this.form.value).forEach(([champ, col]) => {
      if (col) mapping[champ] = col as string;
    });
    this.mappingChange.emit(mapping);
  }

  get previewColumns(): PieceChampDef[] {
    return this.champs.filter(c => this.form.value[c.name]);
  }

  previewValue(row: string[], champ: PieceChampDef): string {
    const col = this.form.value[champ.name];
    if (!col) return '';
    const idx = this.preview.columns.indexOf(col);
    return idx >= 0 ? (row[idx] ?? '') : '';
  }

  get previewSampleRows(): string[][] {
    return (this.preview?.preview_rows || []).slice(0, 5);
  }

  get mappedCount(): number {
    return this.champs.filter(c => !!this.form.value[c.name]).length;
  }
  get totalChamps(): number { return this.champs.length; }

  get unmappedSourceColumns(): string[] {
    if (!this.preview?.columns) return [];
    const used = new Set(Object.values(this.form.value).filter(Boolean) as string[]);
    return this.preview.columns.filter(col => !used.has(col));
  }
}
