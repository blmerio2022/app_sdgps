import {
  AfterViewChecked, Component, ElementRef, HostListener, OnInit, ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { IaAction, IaMessage } from '../../../core/models/ia.model';
import { IaService, messageErreurIa } from '../../../core/services/ia.service';

/** Conversation conservée le temps de l'onglet (jamais côté serveur). */
export const CLE_CONVERSATION = 'sdgps.assistant.conversation';

export const SUGGESTIONS = [
  'Quels dossiers attendent ma validation ?',
  'Où en sont mes dossiers en cours ?',
  'Que manque-t-il à mon dernier SDGPS avant de le soumettre ?',
  'Comment apposer mon cachet sur le rapport ?',
];

/**
 * N°5 — Assistant conversationnel, accessible de partout (bouton flottant).
 *
 * Il répond aux questions sur les dossiers de l'utilisateur et sur l'application ; côté
 * serveur, il n'a que des outils en LECTURE, filtrés par les droits de l'utilisateur.
 * Pour agir (ouvrir un dossier, générer un rapport…), il propose des boutons : c'est
 * l'utilisateur qui clique, et l'action passe par les écrans habituels.
 *
 * Masqué tant que l'IA n'est pas activée sur l'instance.
 */
@Component({
  selector: 'app-ia-assistant',
  templateUrl: './ia-assistant.component.html',
  styleUrls: ['./ia-assistant.component.scss'],
})
export class IaAssistantComponent implements OnInit, AfterViewChecked {
  @ViewChild('fil') fil?: ElementRef<HTMLElement>;
  @ViewChild('saisie') saisie?: ElementRef<HTMLTextAreaElement>;

  readonly suggestions = SUGGESTIONS;
  disponible = false;
  ouvert = false;
  messages: IaMessage[] = [];
  brouillon = '';
  enCours = false;
  erreur = '';
  private defiler = false;

  constructor(private ia: IaService, private router: Router) {}

  ngOnInit(): void {
    this.ia.disponible$.subscribe(d => (this.disponible = d));
    try {
      const brut = JSON.parse(sessionStorage.getItem(CLE_CONVERSATION) || '[]');
      if (Array.isArray(brut)) this.messages = brut.filter(m => m && (m.role === 'user' || m.role === 'assistant'));
    } catch { this.messages = []; }
  }

  ngAfterViewChecked(): void {
    if (this.defiler && this.fil) {
      this.fil.nativeElement.scrollTop = this.fil.nativeElement.scrollHeight;
      this.defiler = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.ouvert) this.ouvert = false; }

  basculer(): void {
    this.ouvert = !this.ouvert;
    if (this.ouvert) {
      this.defiler = true;
      setTimeout(() => this.saisie?.nativeElement.focus(), 50);
    }
  }

  nouvelleConversation(): void {
    if (this.enCours) return;
    this.messages = [];
    this.erreur = '';
    this.memoriser();
  }

  onToucheSaisie(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.envoyer();
    }
  }

  envoyer(texte?: string): void {
    const contenu = (texte ?? this.brouillon).trim();
    if (!contenu || this.enCours) return;
    this.messages = [...this.messages, { role: 'user', content: contenu }];
    this.brouillon = '';
    this.demander();
  }

  /** Renvoie la dernière question restée sans réponse (après une erreur). */
  reessayer(): void { this.demander(); }

  private demander(): void {
    this.enCours = true;
    this.erreur = '';
    this.defiler = true;
    this.memoriser();
    this.ia.assistant(this.messages).subscribe({
      next: (r) => {
        this.enCours = false;
        this.messages = [...this.messages, { role: 'assistant', content: r.reponse, actions: r.actions || [] }];
        this.defiler = true;
        this.memoriser();
      },
      error: (err) => {
        this.enCours = false;
        this.erreur = messageErreurIa(err);
        this.defiler = true;
      },
    });
  }

  /** Exécute une action proposée : navigation vers l'écran concerné (même espace). */
  agir(action: IaAction): void {
    const prefixe = this.router.url.startsWith('/admin/') ? '/admin/' : '/';
    this.router.navigateByUrl(prefixe + action.route.replace(/^\/+/, ''));
    this.ouvert = false;
  }

  /** Lignes d'un message, puces repérées (rendu sans HTML injecté). Les titres Markdown
   * (`## …`) deviennent du texte ; le gras (`**…**`) est rendu par `segments`. */
  lignes(contenu: string): { texte: string; puce: boolean }[] {
    return (contenu || '').split('\n').filter(l => l.trim()).map(l => {
      const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
      const texte = (m ? m[1] : l).replace(/^\s*#{1,6}\s+/, '');
      return { texte, puce: !!m };
    });
  }

  /** Découpe une ligne en segments normaux / gras (`**…**`), affichés par interpolation :
   * aucun HTML venu du modèle n'est jamais interprété. */
  segments(texte: string): { texte: string; gras: boolean }[] {
    return (texte || '').split(/\*\*/).map((t, i) => ({ texte: t, gras: i % 2 === 1 }))
      .filter(s => s.texte);
  }

  get derniereSansReponse(): boolean {
    return !!this.erreur && this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'user';
  }

  private memoriser(): void {
    try { sessionStorage.setItem(CLE_CONVERSATION, JSON.stringify(this.messages.slice(-30))); } catch { /* quota */ }
  }
}
