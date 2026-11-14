import { Component, OnInit } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { BreadcrumbService } from '../../services/breadcrumb.service';
import { UserProfile, BreadcrumbItem, ThemeMode, SidebarState } from '../../interfaces/menu.interface';
import { Observable } from 'rxjs';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-topbar',
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss']
})
export class TopBarComponent implements OnInit {
  
  userProfile$: Observable<UserProfile | null>;
  theme$: Observable<ThemeMode>;
  sidebarState$: Observable<SidebarState>;  // ← AJOUT: État sidebar pour icône dynamique
  breadcrumbs: BreadcrumbItem[] = [];
  showUserMenu = false;

  // Fil d'Ariane métier fourni par les pages (null → repli URL). Le rendu = trail ?? repli.
  private domainTrail: BreadcrumbItem[] | null = null;
  private urlFallback: BreadcrumbItem[] = [];

  constructor(
    private layoutService: LayoutService,
    private breadcrumbService: BreadcrumbService,
    private router: Router
  ) {
    this.userProfile$ = this.layoutService.userProfile$;
    this.theme$ = this.layoutService.theme$;
    this.sidebarState$ = this.layoutService.sidebarState$;  // ← AJOUT
  }

  ngOnInit(): void {
    // Repli déduit de l'URL, recalculé à chaque navigation.
    this.urlFallback = this.buildUrlFallback();
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.urlFallback = this.buildUrlFallback();
      this.renderBreadcrumb();
    });

    // Fil métier prioritaire, publié par les pages via le BreadcrumbService.
    this.breadcrumbService.trail$.subscribe(trail => {
      this.domainTrail = trail;
      this.renderBreadcrumb();
    });
  }

  /** Le fil affiché = fil métier s'il existe, sinon repli URL. */
  private renderBreadcrumb(): void {
    let trail = this.domainTrail ?? this.urlFallback;
    // Dans TOUTES les sections du menu latéral (Projets, Paramètres, Utilisateurs…), on masque
    // le crumb « Accueil » de tête : la section courante et sa hiérarchie se suffisent à elles-
    // mêmes. On le conserve uniquement sur la page d'accueil elle-même (fil réduit à « Accueil »,
    // longueur 1). `slice(1)` ne mute pas le tableau source (fil publié par la page).
    if (trail.length > 1 && trail[0].icon === 'fa-house') {
      trail = trail.slice(1);
    }
    this.breadcrumbs = trail;
  }

  /**
   * Basculer la visibilité de la sidebar
   */
  toggleSidebarVisibility(): void {
    this.layoutService.toggleSidebarVisibility();
  }

  /**
   * Basculer le thème
   */
  toggleTheme(): void {
    this.layoutService.toggleTheme();
  }

  /**
   * Basculer le menu utilisateur
   */
  toggleUserMenu(): void {
    this.showUserMenu = !this.showUserMenu;
  }

  /**
   * Fermer le menu utilisateur
   */
  closeUserMenu(): void {
    this.showUserMenu = false;
  }

  /**
   * Naviguer vers le profil
   */
  goToProfile(): void {
    console.log('👤 Navigation vers profil');
    this.closeUserMenu();
    // `/admin/profile` est protégé par l'AdminGuard (Super Admin / Admin Système / Admin
    // Org). Un opérateur (agent) y est refusé → renvoyé vers /home. On route donc
    // les non-admins vers `/profile` (même page, hors AdminGuard).
    const path = this.isAdminUser() ? '/admin/profile' : '/profile';
    setTimeout(() => { this.router.navigate([path]); }, 100);
  }

  /** Rôles autorisés par l'AdminGuard (peuvent accéder à /admin/**). */
  private isAdminUser(): boolean {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return false;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const role = payload.platform_role || payload.role || 'ROLE_ORGANISATION_AGENT';
      return ['ROLE_SUPER_ADMIN', 'ROLE_ADMIN_SYSTEME', 'ROLE_ORGANISATION_ADMIN'].includes(role);
    } catch {
      return false;
    }
  }

  /**
   * Déconnexion
   */
  logout(): void {
    this.closeUserMenu();
    console.log('🚪 Déconnexion utilisateur');
    
    // Appeler le service de déconnexion
    this.layoutService.logout();
    
    // Redirection vers la page de login
    setTimeout(() => {
      this.router.navigate(['/auth/login']);
      console.log('➡️ Redirection vers /auth/login');
    }, 100);
  }

  /**
   * Construit le fil d'Ariane de REPLI à partir de l'URL (pages hors hiérarchie métier).
   * Un unique point de départ « Accueil » (icône maison) → tableau de bord, suivi de la
   * section courante. Les segments « techniques » (dashboard/home, UUID) sont ignorés.
   */
  private buildUrlFallback(): BreadcrumbItem[] {
    const path = this.router.url.split('?')[0].split('#')[0];
    const segments = path.split('/').filter(s => s);

    const items: BreadcrumbItem[] = [
      { label: 'Accueil', route: '/home', icon: 'fa-house' }
    ];

    const labelMap: { [key: string]: string } = {
      'admin': 'Administration',
      'projets': 'Projets',
      'mes-projets': 'Mes projets',
      'organisations': 'Organisations',
      'organismes': 'Organismes',
      'utilisateurs': 'Utilisateurs',
      'logs-audit': "Journaux d'audit",
      'supervision': 'Supervision',
      'quotas': 'Quotas',
      'maintenance': 'Maintenance',
      'profile': 'Mon profil',
      'parametres': 'Paramètres',
      'reseau-gps': 'Réseau GPS',
    };
    // Segments à ne jamais afficher (déjà couverts par « Accueil » ou non signifiants).
    const skip = new Set(['dashboard', 'home']);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let currentPath = '';
    segments.forEach(seg => {
      currentPath += '/' + seg;
      if (skip.has(seg) || uuidRe.test(seg)) return;
      const label = labelMap[seg] || this.prettifySegment(seg);
      if (!label) return;
      items.push({ label, route: currentPath });
    });

    items[items.length - 1].isActive = true;
    return items;
  }

  /** Transforme un segment d'URL brut en libellé lisible (« logs-audit » → « Logs audit »). */
  private prettifySegment(seg: string): string {
    const s = seg.replace(/[-_]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /**
   * Obtenir les initiales de l'utilisateur pour l'avatar
   */
  getUserInitials(user: UserProfile | null): string {
    if (!user) return 'U';
    const first = user.first_name?.charAt(0) || '';
    const last = user.last_name?.charAt(0) || '';
    return (first + last).toUpperCase();
  }

  /**
   * Libellé « humain » (non technique) du rôle, pour l'affichage dans le menu profil.
   * Le rôle brut (ex. ROLE_ORGANISATION_AGENT) n'est jamais montré à l'utilisateur.
   */
  roleLabel(role?: string | null): string {
    switch (role) {
      case 'ROLE_SUPER_ADMIN': return 'Super administrateur';
      case 'ROLE_ADMIN_SYSTEME': return 'Administrateur de la plateforme';
      case 'ROLE_ORGANISATION_ADMIN': return "Administrateur d'organisation";
      case 'ROLE_ORGANISATION_AGENT': return 'Opérateur';
      default: return 'Utilisateur';
    }
  }

  /** Icône FontAwesome associée au rôle (chip du menu profil). */
  roleIcon(role?: string | null): string {
    switch (role) {
      case 'ROLE_SUPER_ADMIN': return 'fa-crown';
      case 'ROLE_ADMIN_SYSTEME': return 'fa-user-shield';
      case 'ROLE_ORGANISATION_ADMIN': return 'fa-user-tie';
      case 'ROLE_ORGANISATION_AGENT': return 'fa-user-gear';
      default: return 'fa-user';
    }
  }

  /**
   * Gérer l'erreur de chargement d'image - Fallback sur avatar
   */
  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      // Cacher l'image
      img.style.display = 'none';
      // Afficher l'élément suivant (avatar circle)
      const nextSibling = img.nextElementSibling as HTMLElement;
      if (nextSibling) {
        nextSibling.style.display = 'flex';
      }
    }
  }
}
