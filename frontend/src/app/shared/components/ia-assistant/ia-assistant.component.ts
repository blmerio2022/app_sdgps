import {
  AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import {
  IaAction, IaConversation, IaEtatConversations, IaMessageConversation,
} from '../../../core/models/ia.model';
import { IaService, messageErreurIa, telechargerTexte } from '../../../core/services/ia.service';

/** Dernière discussion ouverte (rouverte au prochain affichage). */
export const CLE_DISCUSSION = 'sdgps.assistant.discussion';
/** Panneau agrandi ou compact (préférence d'affichage). */
export const CLE_AGRANDI = 'sdgps.assistant.agrandi';

export const SUGGESTIONS = [
  'Quels dossiers attendent ma validation ?',
  'Où en sont mes dossiers en cours ?',
  'Que manque-t-il à mon dernier SDGPS avant de le soumettre ?',
  'Comment apposer mon cachet sur le rapport ?',
];

export interface Segment { texte: string; gras: boolean; marque: boolean; }

/**
 * N°5 — Assistant conversationnel, accessible de partout (bouton flottant).
 *
 * Les discussions sont ENREGISTRÉES côté serveur, propres à leur auteur : liste avec
 * recherche (titres et messages), épinglage, renommage, archivage, export Markdown,
 * suppression ; dans une discussion : recherche de texte surlignée avec navigation,
 * copie d'un message, régénération de la dernière réponse.
 *
 * L'assistant ne fait que consulter (outils en lecture, filtrés par les droits de
 * l'utilisateur) ; pour agir, il propose des boutons que l'utilisateur clique.
 * Masqué tant que l'IA n'est pas activée sur l'instance.
 */
/** Classe posée sur <body> tant que le bouton flottant de l'assistant est affiché. */
export const ASSISTANT_CLASSE_BODY = 'ias-actif';

@Component({
  selector: 'app-ia-assistant',
  templateUrl: './ia-assistant.component.html',
  styleUrls: ['./ia-assistant.component.scss'],
})
export class IaAssistantComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('fil') fil?: ElementRef<HTMLElement>;
  @ViewChild('saisie') saisie?: ElementRef<HTMLTextAreaElement>;

  readonly suggestions = SUGGESTIONS;
  disponible = false;
  ouvert = false;
  agrandi = false;
  vueListe = false;            // panneau compact : la liste des discussions remplace le fil

  // Discussions
  discussions: IaConversation[] = [];
  recherche = '';
  etat: IaEtatConversations = 'actives';
  chargementListe = false;
  menuOuvert: string | null = null;
  renommage: string | null = null;
  titreEdite = '';
  aSupprimer: string | null = null;

  // Discussion courante
  courante: IaConversation | null = null;
  messages: IaMessageConversation[] = [];
  brouillon = '';
  enCours = false;
  erreur = '';
  copie: number | null = null;

  // Recherche dans la discussion
  chercheOuvert = false;
  cherche = '';
  occurrence = 0;
  nbOccurrences = 0;

  private defiler = false;
  private recalculer = false;
  private recherche$ = new Subject<string>();
  private abonnements: Subscription[] = [];

  constructor(private ia: IaService, private router: Router) {}

  ngOnInit(): void {
    this.abonnements.push(this.ia.disponible$.subscribe(d => {
      this.disponible = d;
      // Le bouton flottant occupe le coin bas-droit de l'écran : la classe permet aux barres
      // de pagination de lui réserver la place (styles.scss) au lieu d'être recouvertes.
      document.body.classList.toggle(ASSISTANT_CLASSE_BODY, d);
    }));
    this.abonnements.push(this.recherche$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.chargerListe()));
    this.agrandi = localStorage.getItem(CLE_AGRANDI) === '1';
  }

  ngOnDestroy(): void {
    this.abonnements.forEach(a => a.unsubscribe());
    document.body.classList.remove(ASSISTANT_CLASSE_BODY);
  }

  ngAfterViewChecked(): void {
    if (this.recalculer) { this.recalculer = false; this.compterOccurrences(); }
    if (this.defiler && this.fil) {
      this.fil.nativeElement.scrollTop = this.fil.nativeElement.scrollHeight;
      this.defiler = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.ouvert) return;
    if (this.chercheOuvert) { this.fermerRecherche(); return; }
    if (this.renommage || this.menuOuvert || this.aSupprimer) {
      this.renommage = this.menuOuvert = this.aSupprimer = null;
      return;
    }
    this.ouvert = false;
  }

  @HostListener('document:click')
  clicDocument(): void { this.menuOuvert = null; }

  // ------------------------------------------------------------ ouverture

  basculer(): void {
    this.ouvert = !this.ouvert;
    if (!this.ouvert) return;
    this.chargerListe();
    const derniere = localStorage.getItem(CLE_DISCUSSION);
    if (derniere && !this.courante) this.ouvrir(derniere, true);
    this.focaliser();
  }

  basculerAgrandi(): void {
    this.agrandi = !this.agrandi;
    this.vueListe = false;
    localStorage.setItem(CLE_AGRANDI, this.agrandi ? '1' : '0');
  }

  private focaliser(): void { setTimeout(() => this.saisie?.nativeElement.focus(), 50); }

  // ------------------------------------------------------------ liste

  onRecherche(valeur: string): void { this.recherche = valeur; this.recherche$.next(valeur.trim()); }

  changerEtat(etat: IaEtatConversations): void { this.etat = etat; this.chargerListe(); }

  chargerListe(): void {
    this.chargementListe = true;
    this.ia.conversations(this.recherche, this.etat).subscribe({
      next: l => { this.discussions = l; this.chargementListe = false; },
      error: () => { this.chargementListe = false; },
    });
  }

  nouvelle(): void {
    if (this.enCours) return;
    this.courante = null;
    this.messages = [];
    this.erreur = '';
    this.vueListe = false;
    this.fermerRecherche();
    localStorage.removeItem(CLE_DISCUSSION);
    this.focaliser();
  }

  ouvrir(id: string, silencieux = false): void {
    this.ia.conversation(id).subscribe({
      next: d => {
        const { messages, ...entete } = d;
        this.courante = entete;
        this.messages = messages;
        this.erreur = '';
        this.vueListe = false;
        localStorage.setItem(CLE_DISCUSSION, id);
        this.defiler = true;
        // Ouverte depuis une recherche : on cherche aussitôt le même texte dedans.
        if (this.recherche.trim() && !silencieux) {
          this.chercheOuvert = true;
          this.cherche = this.recherche.trim();
          this.occurrence = 0;
          this.recalculer = true;
        }
      },
      error: () => { if (!silencieux) this.erreur = 'Discussion introuvable.'; localStorage.removeItem(CLE_DISCUSSION); },
    });
  }

  basculerMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.menuOuvert = this.menuOuvert === id ? null : id;
  }

  commencerRenommage(d: IaConversation, event?: Event): void {
    event?.stopPropagation();
    this.menuOuvert = null;
    this.renommage = d.id;
    this.titreEdite = d.titre;
  }

  /** Renommer la discussion ouverte, depuis l'en-tête (double-clic sur le titre). */
  renommerCourante(): void {
    if (!this.courante) return;
    this.titreEdite = this.courante.titre;
    this.renommage = 'courante';
  }

  validerRenommage(d: IaConversation): void {
    const titre = this.titreEdite.trim();
    this.renommage = null;
    if (!titre || titre === d.titre) return;
    this.modifier(d, { titre });
  }

  epingler(d: IaConversation, event: Event): void {
    event.stopPropagation();
    this.menuOuvert = null;
    this.modifier(d, { epinglee: !d.epinglee }, true);
  }

  archiver(d: IaConversation, event?: Event): void {
    event?.stopPropagation();
    this.menuOuvert = null;
    this.modifier(d, { archivee: !d.archivee }, true);
  }

  private modifier(d: IaConversation, changements: Partial<IaConversation>, recharger = false): void {
    this.ia.modifierConversation(d.id, changements).subscribe({
      next: maj => {
        this.discussions = this.discussions.map(x => (x.id === maj.id ? { ...x, ...maj } : x));
        if (this.courante?.id === maj.id) this.courante = { ...this.courante, ...maj };
        if (recharger) this.chargerListe();
      },
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  demanderSuppression(d: IaConversation, event: Event): void {
    event.stopPropagation();
    this.menuOuvert = null;
    this.aSupprimer = d.id;
  }

  confirmerSuppression(d: IaConversation, event?: Event): void {
    event?.stopPropagation();
    this.ia.supprimerConversation(d.id).subscribe({
      next: () => {
        this.aSupprimer = null;
        this.discussions = this.discussions.filter(x => x.id !== d.id);
        if (this.courante?.id === d.id) this.nouvelle();
      },
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  exporter(d: IaConversation | null, event?: Event): void {
    event?.stopPropagation();
    this.menuOuvert = null;
    if (!d) return;
    this.ia.exporter(d.id).subscribe({
      next: r => telechargerTexte(r.nom_fichier, r.contenu),
      error: err => (this.erreur = messageErreurIa(err)),
    });
  }

  // ------------------------------------------------------------ dialogue

  onToucheSaisie(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.envoyer(); }
  }

  envoyer(texte?: string): void {
    const contenu = (texte ?? this.brouillon).trim();
    if (!contenu || this.enCours) return;
    this.brouillon = '';
    this.erreur = '';
    this.enCours = true;
    const provisoire: IaMessageConversation = { id: -Date.now(), role: 'user', contenu, actions: [],
                                                outils: [], modele: '', created_at: new Date().toISOString() };
    this.messages = [...this.messages, provisoire];
    this.defiler = true;
    const poster = (id: string) => this.ia.envoyerMessage(id, contenu).subscribe({
      next: r => {
        this.messages = [...this.messages.filter(m => m !== provisoire), r.question, r.message];
        if (this.courante) this.courante = { ...this.courante, titre: r.titre || this.courante.titre };
        this.terminer();
      },
      error: err => this.echouer(err),
    });
    if (this.courante) { poster(this.courante.id); return; }
    this.ia.creerConversation().subscribe({
      next: d => {
        const { messages, ...entete } = d;
        this.courante = entete;
        localStorage.setItem(CLE_DISCUSSION, d.id);
        poster(d.id);
      },
      error: err => this.echouer(err),
    });
  }

  /** Refait la dernière réponse (ou répond à la question restée sans réponse). */
  regenerer(): void {
    if (!this.courante || this.enCours) return;
    this.enCours = true;
    this.erreur = '';
    const dernier = this.messages[this.messages.length - 1];
    if (dernier?.role === 'assistant') this.messages = this.messages.slice(0, -1);
    this.defiler = true;
    this.ia.regenerer(this.courante.id).subscribe({
      next: r => { this.messages = [...this.messages, r.message]; this.terminer(); },
      error: err => this.echouer(err),
    });
  }

  private terminer(): void {
    this.enCours = false;
    this.defiler = true;
    this.recalculer = this.chercheOuvert;
    this.chargerListe();
  }

  private echouer(err: any): void {
    this.enCours = false;
    this.erreur = messageErreurIa(err);
    this.defiler = true;
    this.chargerListe();
  }

  get derniereSansReponse(): boolean {
    return !!this.courante && this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'user';
  }

  copier(m: IaMessageConversation): void {
    navigator.clipboard?.writeText(m.contenu).then(() => {
      this.copie = m.id;
      setTimeout(() => (this.copie = null), 1500);
    });
  }

  /** Exécute une action proposée : navigation vers l'écran concerné (même espace). */
  agir(action: IaAction): void {
    const prefixe = this.router.url.startsWith('/admin/') ? '/admin/' : '/';
    this.router.navigateByUrl(prefixe + action.route.replace(/^\/+/, ''));
    if (!this.agrandi) this.ouvert = false;
  }

  // ------------------------------------------------------------ rendu

  /** Lignes d'un message, puces repérées (rendu sans HTML injecté). Les titres Markdown
   * (`## …`) deviennent du texte ; le gras (`**…**`) est rendu par `segments`. */
  lignes(contenu: string): { texte: string; puce: boolean }[] {
    const sortie: { texte: string; puce: boolean }[] = [];
    for (const l of (contenu || '').split('\n')) {
      if (!l.trim()) continue;
      // Ligne de tableau Markdown : séparateur ignoré, cellules jointes par « · ».
      if (/^\s*\|.*\|\s*$/.test(l)) {
        if (/^[\s|:\-]+$/.test(l)) continue;
        sortie.push({ texte: l.split('|').map(c => c.trim()).filter(Boolean).join(' · '), puce: true });
        continue;
      }
      const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
      sortie.push({ texte: (m ? m[1] : l).replace(/^\s*#{1,6}\s+/, ''), puce: !!m });
    }
    return sortie;
  }

  /** Segments normaux / gras (`**…**`) / surlignés (recherche dans la discussion),
   * affichés par interpolation : aucun HTML venu du modèle n'est jamais interprété. */
  segments(texte: string): Segment[] {
    const q = this.chercheOuvert ? this.cherche.trim().toLowerCase() : '';
    const sortie: Segment[] = [];
    (texte || '').split(/\*\*/).forEach((morceau, i) => {
      const gras = i % 2 === 1;
      if (!morceau) return;
      if (!q) { sortie.push({ texte: morceau, gras, marque: false }); return; }
      let reste = morceau;
      let pos = reste.toLowerCase().indexOf(q);
      while (pos >= 0) {
        if (pos > 0) sortie.push({ texte: reste.slice(0, pos), gras, marque: false });
        sortie.push({ texte: reste.slice(pos, pos + q.length), gras, marque: true });
        reste = reste.slice(pos + q.length);
        pos = reste.toLowerCase().indexOf(q);
      }
      if (reste) sortie.push({ texte: reste, gras, marque: false });
    });
    return sortie;
  }

  /** Extrait d'une discussion trouvée par la recherche, découpé pour surligner `q`. */
  extraitSurligne(texte: string): Segment[] {
    const q = this.recherche.trim().toLowerCase();
    if (!q) return [{ texte, gras: false, marque: false }];
    const i = texte.toLowerCase().indexOf(q);
    if (i < 0) return [{ texte, gras: false, marque: false }];
    return [{ texte: texte.slice(0, i), gras: false, marque: false },
            { texte: texte.slice(i, i + q.length), gras: false, marque: true },
            { texte: texte.slice(i + q.length), gras: false, marque: false }];
  }

  dateCourte(iso: string): string {
    const d = new Date(iso);
    const auj = new Date();
    if (d.toDateString() === auj.toDateString()) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  // ------------------------------------------------------------ recherche dans la discussion

  ouvrirRecherche(): void {
    this.chercheOuvert = true;
    this.occurrence = 0;
    setTimeout(() => (document.querySelector('.ias-cherche input') as HTMLInputElement | null)?.focus(), 30);
  }

  fermerRecherche(): void {
    this.chercheOuvert = false;
    this.cherche = '';
    this.nbOccurrences = 0;
    this.occurrence = 0;
  }

  onCherche(valeur: string): void {
    this.cherche = valeur;
    this.occurrence = 0;
    this.recalculer = true;
  }

  private marques(): HTMLElement[] {
    return Array.from(this.fil?.nativeElement.querySelectorAll('mark.occ') || []) as HTMLElement[];
  }

  private compterOccurrences(): void {
    const marques = this.marques();
    this.nbOccurrences = marques.length;
    if (!marques.length) return;
    this.occurrence = Math.min(this.occurrence, marques.length - 1);
    this.allerA(this.occurrence);
  }

  suivante(sens: 1 | -1): void {
    const n = this.marques().length;
    if (!n) return;
    this.occurrence = (this.occurrence + sens + n) % n;
    this.allerA(this.occurrence);
  }

  private allerA(index: number): void {
    const marques = this.marques();
    marques.forEach((m, i) => m.classList.toggle('courante', i === index));
    marques[index]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
