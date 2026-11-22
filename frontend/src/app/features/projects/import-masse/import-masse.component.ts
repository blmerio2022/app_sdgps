import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RefusQuota, estRefusQuota, octetsLisibles, refusQuota } from '../../../core/services/stockage.service';
import { Observable, from, of } from 'rxjs';
import { catchError, concatMap, map, switchMap, toArray } from 'rxjs/operators';
import {
  CandidatImport, FichierDepose, ImagePlan, ImportMasseService, LignePlan, PlanImport, PointPlan,
  dossiersFilesManquants, estPageCadre, lireDossiersFiles, lireEntree, utile,
} from '../../../core/services/import-masse.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { PieceImportPreview, PieceTypeDef } from '../../../core/models/piece.model';
import { PdfRenderService, canvasToJpeg } from '../../../core/services/pdf-render.service';

export interface SessionChoix { id: string; numero_session: number; }

type Etape = 'depot' | 'plan' | 'import' | 'fin';
interface Resultat {
  fichier: string; ok: boolean; detail: string;
  /** Ce que l'envoi devait ajouter : une pièce (ses données) ou un lot d'images. */
  nature?: 'piece' | 'images' | 'autre';
  /** Refus pour quota de stockage dépassé (chiffres du serveur si fournis). */
  quota?: boolean;
  chiffres?: RefusQuota | null;
  nbImages?: number;
}

export const LIBELLES_IMAGES: Record<string, string> = {
  PPA: 'Photos des points anciens', PPN: 'Photos des points nouveaux',
  CCSPA: 'Canevas de contrôle de stabilité', CDC: 'Canevas de densification', CLC: 'Canevas de levé',
  RDC: 'Rapport de consultation',
};

/**
 * Import en masse d'un dossier (modale) : déposer les fichiers — ou le DOSSIER entier, pour
 * que les rapports HTML de TBC soient lus depuis leur dossier `_files` —, vérifier le plan
 * proposé (pièces, images rattachées aux points, rapport de contrôle), puis importer.
 * Chaque étape passe par les imports unitaires : mêmes contrôles côté serveur.
 */
@Component({
  selector: 'app-import-masse',
  templateUrl: './import-masse.component.html',
  styleUrls: ['./import-masse.component.scss'],
})
export class ImportMasseComponent {
  @Input() ssdgpsId!: string;
  /** Sessions du SDGPS (multi-session : une pièce de niveau session doit en choisir une). */
  @Input() sessions: SessionChoix[] = [];
  @Input() multiSession = false;
  @Output() fermee = new EventEmitter<void>();
  @Output() termine = new EventEmitter<number>();

  etape: Etape = 'depot';
  depots: FichierDepose[] = [];
  ignoresAuDepot = 0;
  reponse: PlanImport | null = null;
  plan: LignePlan[] = [];
  images: ImagePlan[] = [];
  sessionParLigne: Record<number, string | null> = {};
  genererRc = false;
  analyse = false;
  /** Message pendant la préparation (conversion des PDF). */
  preparation = '';
  pagesPdf = 0;
  pdfIllisibles: string[] = [];
  /** Poignée native d'un rapport HTML choisi (ouvre le dialogue de dossier au bon endroit). */
  poigneeHtml: any = null;
  /** Déterminations intermédiaires : une pièce par détermination, ou une seule assemblée. */
  modeDeterminations: 'separees' | 'assemblees' = 'separees';
  /** Assemblées : la détermination libre entre dans la RDIA (vrai) ou reste une pièce RDL. */
  libreDansRdia = true;
  erreur = '';
  survol = false;
  progression = 0;
  resultats: Resultat[] = [];
  readonly libellesImages = LIBELLES_IMAGES;
  readonly typesImages = Object.keys(LIBELLES_IMAGES);

  constructor(private service: ImportMasseService, private pieces: PiecesService,
              private pdf: PdfRenderService) {}

  // ---- correspondance des colonnes d'une ligne (manuelle ou par l'IA) ----
  /** Ligne dont la correspondance est en cours d'édition (null : fenêtre fermée). */
  correspondanceLigne: LignePlan | null = null;
  correspondancePreview: PieceImportPreview | null = null;
  correspondanceProposee: Record<string, string> | null = null;
  private correspondanceEnCours: Record<string, string> = {};
  private catalogue: PieceTypeDef[] | null = null;

  /** Champs du type mappés (hors ID) : ce que l'opérateur lit dans la colonne « Type ». */
  champsMappes(l: LignePlan): number { return Object.keys(l.mapping || {}).filter(k => k !== 'id').length; }

  /** Ouvre l'outil de correspondance sur la ligne : proposition automatique du plan comme
   * référence, choix courant comme départ, IA disponible dans l'outil s'il est activé. */
  ouvrirCorrespondance(l: LignePlan): void {
    if (l.mode !== 'tableau' || !l.type_piece) return;
    const ouvrir = (types: PieceTypeDef[]) => {
      const def = types.find(t => t.code === l.type_piece);
      if (!def) return;
      this.correspondanceLigne = l;
      this.correspondanceProposee = { ...(this.candidat(l)?.mapping || {}) };
      this.correspondanceEnCours = { ...(l.mapping || {}) };
      this.correspondancePreview = { columns: l.colonnes || [], preview_rows: l.apercu || [],
                                     total_rows: l.lignes, champs: def.champs };
    };
    if (this.catalogue) { ouvrir(this.catalogue); return; }
    this.pieces.getCatalog().subscribe({ next: types => { this.catalogue = types; ouvrir(types); } });
  }

  onCorrespondance(mapping: Record<string, string>): void { this.correspondanceEnCours = mapping; }

  appliquerCorrespondance(): void {
    const l = this.correspondanceLigne;
    if (!l) return;
    l.mapping = { ...this.correspondanceEnCours };
    l.mappingModifie = JSON.stringify(l.mapping) !== JSON.stringify(this.correspondanceProposee || {});
    this.fermerCorrespondance();
  }

  fermerCorrespondance(): void {
    this.correspondanceLigne = null;
    this.correspondancePreview = null;
    this.correspondanceProposee = null;
  }

  // ---- étape 1 : dépôt (fichiers ou dossier) ----
  ajouterDepots(liste: FichierDepose[]): void {
    const deja = new Set(this.depots.map(d => d.chemin + d.fichier.size));
    for (const d of liste) {
      if (!utile(d.chemin)) { this.ignoresAuDepot++; continue; }
      if (deja.has(d.chemin + d.fichier.size)) continue;
      deja.add(d.chemin + d.fichier.size);
      this.depots.push(d);
    }
  }

  ajouter(liste: FileList | File[] | null): void {
    if (!liste) return;
    this.ajouterDepots(Array.from(liste).map(f => ({ fichier: f, chemin: (f as any).webkitRelativePath || f.name })));
  }

  /** « Choisir des fichiers » : le dialogue CLASSIQUE du navigateur (champ fichier), le même
   * mécanisme que « Choisir un dossier ». Le sélecteur natif `showOpenFilePicker`, essayé
   * pour retrouver le dossier des rapports HTML, laissait la liste vide chez l'utilisateur. */
  choisirFichiers(champ: HTMLInputElement): void {
    champ.click();
  }

  async onDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    this.survol = false;
    const items = Array.from(ev.dataTransfer?.items || []);
    // Poignées natives (lues pendant l'évènement) : elles ouvrent le dossier d'un rapport HTML.
    const poignees = items.map(i => (i as any).getAsFileSystemHandle?.()).filter(Boolean);
    Promise.all(poignees).then(ps => {
      const html = ps.find((p: any) => p?.kind === 'file' && /\.html?$/i.test(p.name));
      if (html) this.poigneeHtml = html;
    }).catch(() => {});
    const entrees = items.map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    if (entrees.length) {
      const lus = await Promise.all(entrees.map(e => lireEntree(e)));
      this.ajouterDepots(lus.flat());
    } else {
      this.ajouter(ev.dataTransfer?.files || null);
    }
  }
  onDragOver(ev: DragEvent): void { ev.preventDefault(); this.survol = true; }
  retirer(i: number): void { this.depots.splice(i, 1); }
  vider(): void { this.depots = []; this.ignoresAuDepot = 0; }

  get resumeDepot(): { tableaux: number; html: number; images: number; pdf: number } {
    const c = (re: RegExp) => this.depots.filter(d => re.test(d.chemin)).length;
    return { tableaux: c(/\.(csv|xlsx)$/i), html: c(/\.html?$/i), images: c(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic)$/i),
             pdf: c(/\.pdf$/i) };
  }

  /** PDF déposés : chaque page est rendue en image dans le navigateur (le serveur ne rend
   * pas les PDF), puis classée comme les autres images (canevas, consultation, photos). */
  async convertirPdf(): Promise<void> {
    const pdfs = this.depots.filter(d => /\.pdf$/i.test(d.chemin));
    if (!pdfs.length) return;
    this.preparation = `Conversion de ${pdfs.length} PDF en images…`;
    const pages: FichierDepose[] = [];
    for (const d of pdfs) {
      try {
        const doc = await this.pdf.open(d.fichier);
        const base = d.fichier.name.replace(/\.pdf$/i, '');
        const dossier = d.chemin.includes('/') ? d.chemin.slice(0, d.chemin.lastIndexOf('/') + 1) : '';
        for (let n = 1; n <= doc.numPages; n++) {
          const canvas = await doc.renderPage(n, 1600);
          const nom = doc.numPages > 1 ? `${base}-p${n}.jpg` : `${base}.jpg`;
          pages.push({ fichier: await canvasToJpeg(canvas, nom, 2 * 1024 * 1024), chemin: dossier + nom });
        }
        doc.destroy();
        this.pagesPdf += doc.numPages;
      } catch {
        this.pdfIllisibles.push(d.chemin);
      }
    }
    this.depots = this.depots.filter(d => !/\.pdf$/i.test(d.chemin)).concat(pages);
    this.preparation = '';
  }

  analyser(): void {
    if (!this.depots.length) return;
    this.analyse = true; this.erreur = '';
    const manquants = dossiersFilesManquants(this.depots);
    if (manquants.size && (window as any).showDirectoryPicker) {
      // Appelé dans le clic : le navigateur n'ouvre ce dialogue qu'en réponse à un geste.
      this.recupererDossiersFiles(manquants).then(() => this.preparer());
    } else {
      this.preparer();
    }
  }

  private preparer(): void {
    if (this.depots.some(d => /\.pdf$/i.test(d.chemin))) {
      this.convertirPdf().then(() => this.lancerAnalyse());
    } else {
      this.lancerAnalyse();
    }
  }

  /**
   * Rapports HTML de TBC choisis sans leur dossier « _files » : le navigateur interdit à une
   * page d'ouvrir un dossier voisin d'un fichier sans l'accord de l'utilisateur. On ouvre donc
   * le dialogue d'accès au dossier, positionné sur celui du rapport ; un clic suffit, puis les
   * dossiers « _files » sont lus automatiquement.
   */
  async recupererDossiersFiles(manquants: Map<string, Set<string>>): Promise<void> {
    const cadres = this.depots.filter(d => /\.html?$/i.test(d.chemin) && !/_files\//i.test(d.chemin));
    const verifies = await Promise.all(cadres.map(d => estPageCadre(d.fichier)));
    if (!verifies.some(Boolean)) return;                 // rapports HTML autonomes : rien à chercher
    this.preparation = 'Autorisez la lecture du dossier des rapports HTML…';
    try {
      const options: any = { id: 'sdgps-import-masse', mode: 'read' };
      if (this.poigneeHtml) options.startIn = this.poigneeHtml;
      const dossier = await (window as any).showDirectoryPicker(options);
      for (const [prefixe, noms] of manquants) {
        this.ajouterDepots(await lireDossiersFiles(dossier, noms, prefixe));
      }
    } catch { /* accès refusé ou annulé : le plan signalera les pages-cadres */ }
    this.preparation = '';
  }

  private lancerAnalyse(): void {
    this.service.plan(this.ssdgpsId, this.depots).subscribe({
      next: p => {
        this.reponse = p;
        this.plan = p.plan;
        this.images = p.images;
        this.genererRc = p.rc_possible;
        this.sessionParLigne = {};
        this.plan.forEach((_, i) => (this.sessionParLigne[i] = null));
        // Action proposée par le serveur, gardée pour pouvoir changer de mode de déterminations.
        this.plan.forEach(l => ((l as any)._propose = l.action));
        this.modeDeterminations = this.plan.some(l => l.type_piece === 'RDN' && l.action !== 'ignorer') ? 'separees'
          : (this.plan.some(l => l.type_piece === 'RDIA') ? 'assemblees' : 'separees');
        this.appliquerModeDeterminations();
        // Une seule session : elle s'impose à toutes les pièces de niveau session.
        this.sessionCommune = this.multiSession && this.sessions.length === 1 ? this.sessions[0].id : null;
        if (this.sessionCommune) this.appliquerSessionCommune();
        this.analyse = false; this.etape = 'plan';
      },
      error: e => { this.analyse = false; this.erreur = e?.error?.detail || 'Analyse des fichiers impossible.'; },
    });
  }

  // ---- étape 2 : plan ----
  /** Pages-cadres TBC déposées sans leur dossier `_files` : leurs données manquent. */
  get cadresSansDonnees(): LignePlan[] { return this.plan.filter(l => l.cadre); }

  /** Ajout du (des) dossier(s) `_files` manquant(s), puis nouvelle analyse. */
  ajouterDossiersManquants(liste: FileList | null): void {
    this.ajouter(liste);
    this.analyser();
  }

  candidat(l: LignePlan): CandidatImport | undefined { return l.candidats.find(c => c.type_piece === l.type_piece); }

  changerType(l: LignePlan, type: string | null): void {
    l.type_piece = type;
    const c = this.candidat(l);
    l.mapping = c ? { ...c.mapping } : {};
    l.mappingModifie = false;
    l.numero = c?.repetable ? (l.numero || c.numero_nom || 1) : null;
    l.piece_existante = null;   // l'existant n'est connu que pour le type proposé
    l.action = type ? 'creer' : 'ignorer';
  }

  /** Session appliquée d'un coup à toutes les pièces de niveau session (multi-session). */
  sessionCommune: string | null = null;

  get piecesSansSession(): number {
    return this.plan.filter((l, i) => this.sessionRequise(l) && !this.sessionParLigne[i]).length;
  }
  get demandeSession(): boolean { return this.plan.some(l => this.sessionRequise(l)); }
  get sessionsTriees(): SessionChoix[] { return [...this.sessions].sort((a, b) => a.numero_session - b.numero_session); }

  appliquerSessionCommune(): void {
    this.plan.forEach((l, i) => { if (this.sessionRequise(l)) this.sessionParLigne[i] = this.sessionCommune; });
  }

  sessionRequise(l: LignePlan): boolean {
    return this.multiSession && this.candidat(l)?.niveau === 'session' && l.action === 'creer';
  }

  /** Pourquoi la ligne ne peut pas être importée telle quelle (vide = prête). */
  blocage(l: LignePlan, i: number): string {
    if (l.action === 'ignorer') return '';
    if (!l.type_piece) return 'Choisissez un type';
    if (l.mode === 'tableau' && !Object.keys(l.mapping || {}).length) return 'Aucune colonne reconnue';
    if (this.candidat(l)?.repetable && !l.numero) return 'Numéro requis';
    if (this.sessionRequise(l) && !this.sessionParLigne[i]) return 'Session requise';
    return '';
  }

  // ---- déterminations intermédiaires : séparées (RDN n°k) ou assemblées (une RDIA) ----
  /** Le choix n'a de sens que si le lot contient des déterminations (n°k ou assemblées). */
  get choixDeterminations(): boolean {
    return this.plan.some(l => (l.type_piece === 'RDN' || l.type_piece === 'RDIA') && !l.doublon);
  }
  get nbDeterminations(): number {
    return this.plan.filter(l => l.type_piece === 'RDN' && !l.doublon && (l as any)._propose !== 'ignorer').length;
  }
  get fichierRdia(): LignePlan | undefined {
    return this.plan.find(l => l.type_piece === 'RDIA' && !l.doublon && (l as any)._propose !== 'ignorer');
  }

  /** Ligne de la détermination libre du lot (RDL), s'il y en a une. */
  get ligneLibre(): LignePlan | undefined {
    return this.plan.find(l => l.type_piece === 'RDL' && !l.doublon && (l as any)._propose !== 'ignorer');
  }

  appliquerModeDeterminations(): void {
    for (const l of this.plan) {
      const propose = (l as any)._propose ?? l.action;
      if (l.doublon || propose === 'ignorer') continue;
      // Libre : à part (pièce RDL) sauf si elle est intégrée à une RDIA assemblée par l'application.
      if (l.type_piece === 'RDL') {
        l.action = this.assemblerDepuisDeterminations && this.libreDansRdia ? 'ignorer' : propose;
      }
      if (l.type_piece === 'RDN') l.action = this.modeDeterminations === 'separees' ? propose : 'ignorer';
      // Assemblées : on assemble les déterminations n°k du lot (rapports HTML d'abord) ; le
      // fichier RDIA fourni ne sert que s'il n'y a aucune détermination à assembler.
      if (l.type_piece === 'RDIA') {
        l.action = this.modeDeterminations === 'assemblees' && this.nbDeterminations === 0 ? propose : 'ignorer';
      }
    }
  }

  /** Assemblée sans fichier RDIA fourni : l'application assemble la libre + les n°k. */
  get assemblerDepuisDeterminations(): boolean {
    return this.modeDeterminations === 'assemblees' && this.nbDeterminations > 0;
  }

  // ---- quota de stockage ----
  /** Octets que l'import va stocker : fichiers des pièces retenues + images. */
  get octetsAStocker(): number {
    // Chaque pièce importée stocke son fichier (un classeur à plusieurs feuilles est stocké
    // une fois par feuille importée) ; chaque image retenue est stockée.
    const pieces = this.plan.filter(l => l.action !== 'ignorer').map(l => this.depots[l.index]?.fichier?.size || 0);
    const images = this.imagesRetenues.map(i => this.depots[i.index]?.fichier?.size || 0);
    return [...pieces, ...images].reduce((a, b) => a + b, 0);
  }

  get depasseQuota(): boolean {
    const q = this.reponse?.quota;
    return !!q && !q.is_unlimited && q.remaining_bytes !== null && this.octetsAStocker > q.remaining_bytes;
  }

  mo(octets: number | null | undefined): string {
    return `${((octets || 0) / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  }

  /** Résultat d'un envoi en échec. Un refus de quota reçoit un libellé court (« … non créée ») :
   * l'explication complète est donnée UNE fois, dans l'encadré du bilan. */
  private echec(fichier: string, e: any, nature: 'piece' | 'images', libelleQuota: string): Resultat {
    if (estRefusQuota(e)) {
      return { fichier, ok: false, nature, quota: true, chiffres: refusQuota(e),
               detail: `${libelleQuota} (quota de stockage dépassé).` };
    }
    return { fichier, ok: false, nature, detail: this.messageErreur(e) };
  }

  /** Refus pour quota, regroupés dans le bilan (un message au lieu d'un par photo). */
  get refusQuota(): number { return this.resultats.filter(r => r.quota).length; }
  get piecesRefuseesQuota(): Resultat[] { return this.resultats.filter(r => r.quota && r.nature === 'piece'); }
  get lotsImagesRefusesQuota(): Resultat[] { return this.resultats.filter(r => r.quota && r.nature === 'images'); }
  get imagesRefuseesQuota(): number { return this.lotsImagesRefusesQuota.reduce((n, r) => n + (r.nbImages || 0), 0); }
  /** Chiffres du dernier refus (le plus à jour) : organisation, utilisé, plafond, restant. */
  get chiffresQuota(): RefusQuota | null {
    return [...this.resultats].reverse().find(r => r.chiffres)?.chiffres || null;
  }
  readonly taille = octetsLisibles;

  /** Liste lisible des envois refusés (tronquée au-delà de 8). */
  nomsRefuses(liste: Resultat[]): string {
    const noms = liste.map(r => r.fichier);
    return noms.slice(0, 8).join(', ') + (noms.length > 8 ? `… (+${noms.length - 8})` : '');
  }

  /** Page « Mon espace de stockage », dans la zone courante (opérateur ou admin). */
  get lienStockage(): string {
    return (typeof location !== 'undefined' && location.pathname.startsWith('/admin') ? '/admin' : '') + '/parametres/stockage';
  }

  sourcesAssemblage(): { label: string; rows: any[] }[] {
    const libre = this.libreDansRdia
      ? this.plan.find(l => l.type_piece === 'RDL' && !l.doublon && l.donnees?.length) : undefined;
    const nk = this.plan.filter(l => l.type_piece === 'RDN' && !l.doublon && (l as any)._propose !== 'ignorer' && l.donnees?.length)
      .sort((a, b) => (a.numero || 0) - (b.numero || 0));
    return [...(libre ? [{ label: 'Libre', rows: libre.donnees! }] : []),
            ...nk.map(l => ({ label: `N°${l.numero}`, rows: l.donnees! }))];
  }

  // ---- images ----
  pointsDe(type: string | null): PointPlan[] {
    return (type === 'PPA' || type === 'PPN') ? (this.reponse?.points[type] || []) : [];
  }

  changerTypeImage(img: ImagePlan, type: string | null): void {
    img.type_piece = type;
    if (!this.pointsDe(type).some(p => p.cle === img.point_ref)) { img.point = ''; img.point_ref = ''; }
  }

  changerPointImage(img: ImagePlan, cle: string): void {
    img.point_ref = cle;
    img.point = this.pointsDe(img.type_piece).find(p => p.cle === cle)?.nom || '';
  }

  get imagesRetenues(): ImagePlan[] { return this.images.filter(i => !!i.type_piece); }
  get imagesSansPoint(): number {
    return this.imagesRetenues.filter(i => (i.type_piece === 'PPA' || i.type_piece === 'PPN') && !i.point_ref).length;
  }
  get aImporter(): number { return this.plan.filter(l => l.action !== 'ignorer').length; }
  get pret(): boolean {
    return (this.aImporter > 0 || this.imagesRetenues.length > 0 || this.genererRc || this.assemblerDepuisDeterminations)
      && this.plan.every((l, i) => !this.blocage(l, i));
  }
  pourcent(c?: CandidatImport | null): number { return Math.round(Math.min(1, c?.score || 0) * 100); }
  icone(l: LignePlan): string { return l.mode === 'html' ? 'fa-file-code' : (l.feuille ? 'fa-file-excel' : 'fa-file-csv'); }

  // ---- étape 3 : import (pièces, puis images, puis rapport de contrôle) ----
  importer(): void {
    if (!this.pret || !this.reponse) return;
    this.etape = 'import'; this.progression = 0; this.resultats = [];
    const creees: Record<string, string> = {};                 // type → pièce (pour y rattacher les images)
    const travaux = this.plan.map((l, i) => ({ l, i, f: this.depots[l.index]?.fichier }))
      .filter(t => t.l.action !== 'ignorer' && t.f);
    const groupes = this.groupesImages();
    const assembler = this.assemblerDepuisDeterminations;
    const total = travaux.length + groupes.length + (this.genererRc ? 1 : 0) + (assembler ? 1 : 0);
    const avancer = (r: Resultat) => {
      this.resultats.push(r);
      this.progression = Math.round(100 * this.resultats.length / Math.max(1, total));
    };

    const etapePieces$ = from(travaux).pipe(concatMap(t => {
      const appel = t.l.mode === 'html'
        ? this.service.importerHtml(this.ssdgpsId, t.f!, t.l, this.sessionParLigne[t.i])
        : this.service.importer(this.ssdgpsId, t.f!, t.l, this.sessionParLigne[t.i]);
      return appel.pipe(
        map((p: any) => {
          if (p?.id && t.l.type_piece && !creees[t.l.type_piece]) creees[t.l.type_piece] = p.id;
          return { fichier: t.l.fichier, ok: true, detail: `${t.l.type_piece}${t.l.numero ? ' n°' + t.l.numero : ''} ${t.l.action === 'remplacer' ? 'remplacée' : 'créée'}` };
        }),
        catchError(e => of(this.echec(t.l.fichier, e, 'piece',
          `${t.l.type_piece || 'Pièce'}${t.l.numero ? ' n°' + t.l.numero : ''} non ${t.l.action === 'remplacer' ? 'remplacée' : 'créée'} : ses données n'ont pas été ajoutées`))),
      );
    }));

    const etapeImages$ = from(groupes).pipe(concatMap(g => this.cible(g.type, creees).pipe(
      switchMap(id => this.pieces.addImages(id, g.fichiers, g.pointRef || undefined)),
      map(() => ({ fichier: `${g.fichiers.length} image(s)`, ok: true,
                   detail: `${g.type}${g.point ? ' · point ' + g.point : ''}` })),
      catchError(e => of({ ...this.echec(`${g.fichiers.length} image(s) ${g.type}${g.point ? ' · point ' + g.point : ''}`, e, 'images',
        `${g.fichiers.length} image(s) non ajoutée(s)`), nbImages: g.fichiers.length })),
    )));

    // Déterminations « assemblées » : une seule RDIA, remplacée si elle existe déjà.
    const etapeRdia$: Observable<Resultat> = assembler
      ? this.service.assemblerRdia(this.ssdgpsId, this.sourcesAssemblage(), this.reponse.pieces_existantes['RDIA'],
                                   this.libreDansRdia).pipe(
          map(() => ({ fichier: 'Déterminations intermédiaires', ok: true,
                       detail: `RDIA assemblée (${this.sourcesAssemblage().length} détermination(s))` })),
          catchError(e => of({ fichier: 'Déterminations intermédiaires', ok: false, detail: this.messageErreur(e) })))
      : from([] as Resultat[]);

    const etapeRc$ = this.genererRc ? this.rapportDeControle() : from([] as Resultat[]);

    etapePieces$.pipe(toArray()).subscribe(r1 => {
      r1.forEach(avancer);
      etapeRdia$.pipe(toArray()).subscribe(r0 => {
        r0.forEach(avancer);
        etapeImages$.pipe(toArray()).subscribe(r2 => {
          r2.forEach(avancer);
          etapeRc$.pipe(toArray()).subscribe(r3 => {
            r3.forEach(avancer);
            this.etape = 'fin';
            this.termine.emit(this.reussis);
          });
        });
      });
    });
  }

  /** Images regroupées par pièce et par point (un envoi par groupe). */
  groupesImages(): { type: string; point: string; pointRef: string; fichiers: File[] }[] {
    const groupes = new Map<string, { type: string; point: string; pointRef: string; fichiers: File[] }>();
    for (const img of this.imagesRetenues) {
      const f = this.depots[img.index]?.fichier;
      if (!f) continue;
      const photo = img.type_piece === 'PPA' || img.type_piece === 'PPN';
      // `point_ref` = clé du point dans la pièce (ID de ligne) : c'est elle que lit la page des photos.
      const pointRef = photo ? (img.point_ref || '') : '';
      const cle = `${img.type_piece}|${pointRef}`;
      if (!groupes.has(cle)) groupes.set(cle, { type: img.type_piece!, point: photo ? img.point : '', pointRef, fichiers: [] });
      groupes.get(cle)!.fichiers.push(f);
    }
    return Array.from(groupes.values());
  }

  /** Pièce qui reçoit les images d'un type : créée à l'étape précédente, existante, ou nouvelle. */
  private cible(type: string, creees: Record<string, string>): Observable<string> {
    const id = creees[type] || this.reponse?.pieces_existantes[type];
    if (id) return of(id);
    return this.pieces.createImagePiece(type, { ssdgps: this.ssdgpsId } as any).pipe(map((p: any) => {
      creees[type] = p.id;
      return p.id as string;
    }));
  }

  private rapportDeControle(): Observable<Resultat> {
    const parent = { ssdgps: this.ssdgpsId } as any;
    return this.pieces.previewComputeRc(parent).pipe(
      switchMap(apercu => {
        const existant = this.reponse?.pieces_existantes['RC'];
        return (existant ? this.service.remplacerLignes(existant, apercu.rows)
                         : this.pieces.confirmComputeRc(parent, apercu.rows, apercu.source)).pipe(
          map(() => ({ fichier: 'Rapport de contrôle', ok: true,
                       detail: `${apercu.rows.length} ligne(s) ${existant ? 'recalculées' : 'calculées'}` })));
      }),
      catchError(e => of({ fichier: 'Rapport de contrôle', ok: false, detail: this.messageErreur(e) })),
    );
  }

  get reussis(): number { return this.resultats.filter(r => r.ok).length; }

  messageErreur(e: any): string {
    const d = e?.error;
    if (!d) return 'Échec de l’import';
    if (typeof d.detail === 'string') return d.detail;
    const premier = Object.entries(d)[0] as [string, any] | undefined;
    return premier ? `${premier[0]} : ${Array.isArray(premier[1]) ? premier[1][0] : premier[1]}` : 'Échec de l’import';
  }

  fermer(): void { if (this.etape !== 'import') this.fermee.emit(); }
}
