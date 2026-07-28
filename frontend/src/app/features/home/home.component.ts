import { formatDateTime } from '../../shared/utils/date-format.util';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ProjectsService } from '../../core/services/projects.service';
import { ProfileService, UserProfile } from '../profile/services/profile.service';
import { Projet, ProjetStatut } from '../../core/models/project.model';

/** Une tuile KPI (compteur métier). */
interface Kpi {
  key: string;
  label: string;
  icon: string;
  value: number;
}

/** Un segment de la répartition des projets par statut. */
interface StatutSegment {
  key: ProjetStatut;
  label: string;
  color: string;
  count: number;
  pct: number;
}

/** Une carte d'action rapide. */
interface QuickAction {
  label: string;
  hint: string;
  icon: string;
  route: string;
}

/**
 * Accueil de l'opérateur (agent d'organisation) : `/home`.
 *
 * Tableau de bord synthétique du périmètre de l'utilisateur connecté — KPI métier
 * (projets → propriétés → affaires → SSDGPS → sessions → pièces), répartition des
 * projets par statut, projets récents et actions rapides. Toutes les données sont
 * dérivées d'un unique appel `getProjets` (compteurs agrégés portés par chaque projet)
 * + `getCurrentUser` pour l'en-tête personnalisé : aucun endpoint dédié requis.
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  loading = true;
  user: UserProfile | null = null;
  private projets: Projet[] = [];

  kpis: Kpi[] = [];
  segments: StatutSegment[] = [];
  totalProjets = 0;
  recentProjets: Projet[] = [];

  /** Couleurs sémantiques des statuts (cohérentes en thème clair/sombre). */
  private readonly STATUT_META: Record<ProjetStatut, { label: string; color: string; badge: string }> = {
    brouillon: { label: 'Brouillon', color: '#8a94a6', badge: 'badge-brouillon' },
    en_cours:  { label: 'En cours',  color: '#cc5858', badge: 'badge-en_cours' },
    cloture:   { label: 'Clôturé',   color: '#16a34a', badge: 'badge-cloture' },
    archive:   { label: 'Archivé',   color: '#d9a441', badge: 'badge-archive' },
  };

  readonly quickActions: QuickAction[] = [
    { label: 'Explorer les projets', hint: 'Projets, propriétés, affaires…', icon: 'fa-diagram-project', route: '/projets' },
    { label: 'Tri des pièces',       hint: 'Ordre par défaut des tableaux',  icon: 'fa-sort-amount-down', route: '/parametres/tri-pieces' },
    { label: 'Champs des pièces',    hint: 'Colonnes affichées par type',    icon: 'fa-table-columns',    route: '/parametres/champs-pieces' },
    { label: 'Mon profil',           hint: 'Coordonnées & préférences',      icon: 'fa-user',             route: '/profile' },
  ];

  constructor(
    private projectsService: ProjectsService,
    private profile: ProfileService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    forkJoin({
      user: this.profile.getCurrentUser().pipe(catchError(() => of(null))),
      projets: this.projectsService.getProjets({}).pipe(catchError(() => of([] as Projet[]))),
    }).subscribe(({ user, projets }) => {
      this.user = user;
      this.projets = projets;
      this.computeStats();
      this.loading = false;
    });
  }

  private computeStats(): void {
    const sum = (field: keyof Projet): number =>
      this.projets.reduce((acc, p) => acc + (Number(p[field]) || 0), 0);

    this.totalProjets = this.projets.length;
    this.kpis = [
      { key: 'projets',    label: 'Projets',        icon: 'fa-diagram-project', value: this.totalProjets },
      { key: 'proprietes', label: 'Propriétés',     icon: 'fa-map-marker-alt',  value: sum('nbr_total_proprietes') },
      { key: 'affaires',   label: 'Affaires (SD)',  icon: 'fa-file-signature',  value: sum('nbr_total_affaires') },
      { key: 'ssdgps',     label: 'SSDGPS',         icon: 'fa-satellite-dish',  value: sum('nbr_total_ssdgps') },
      { key: 'sessions',   label: 'Sessions',       icon: 'fa-clock',           value: sum('nbr_total_sessions') },
      { key: 'pieces',     label: 'Pièces',         icon: 'fa-paperclip',       value: sum('nbr_total_pieces') },
    ];

    // Répartition par statut (ordre du cycle de vie).
    const order: ProjetStatut[] = ['brouillon', 'en_cours', 'cloture', 'archive'];
    const counts: Record<ProjetStatut, number> = { brouillon: 0, en_cours: 0, cloture: 0, archive: 0 };
    for (const p of this.projets) {
      if (p.statut && p.statut in counts) counts[p.statut]++;
    }
    const total = this.totalProjets || 1;
    this.segments = order.map(key => ({
      key,
      label: this.STATUT_META[key].label,
      color: this.STATUT_META[key].color,
      count: counts[key],
      pct: Math.round((counts[key] / total) * 100),
    }));

    // Projets récents (derniers modifiés).
    this.recentProjets = [...this.projets]
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .slice(0, 5);
  }

  /** Salutation selon l'heure locale. */
  get greeting(): string {
    const h = new Date().getHours();
    if (h < 5) return 'Bonsoir';
    if (h < 18) return 'Bonjour';
    return 'Bonsoir';
  }

  get firstName(): string {
    return this.user?.first_name || this.user?.full_name || this.user?.email?.split('@')[0] || '';
  }

  statutLabel(s?: ProjetStatut | string): string {
    return s && (s in this.STATUT_META) ? this.STATUT_META[s as ProjetStatut].label : (s || '—');
  }

  statutBadgeClass(s?: ProjetStatut | string): string {
    return s && (s in this.STATUT_META) ? this.STATUT_META[s as ProjetStatut].badge : 'badge-brouillon';
  }

  /** Date « humaine » (JJ/MM/AAAA HH:mm) ou tiret. */
  formatDate(value?: string | null): string {
    return formatDateTime(value);
  }

  openProjets(): void {
    this.router.navigate(['/projets']);
  }

  openProjet(p: Projet): void {
    this.router.navigate(['/projets', p.id]);
  }

  go(route: string): void {
    this.router.navigate([route]);
  }

  /** Placeholders de chargement (skeleton). */
  readonly skeletons = [0, 1, 2, 3, 4, 5];
}
