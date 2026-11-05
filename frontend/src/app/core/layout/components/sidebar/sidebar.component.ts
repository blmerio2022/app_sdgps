import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LayoutService } from '../../services/layout.service';
import { MenuItem, SidebarState } from '../../interfaces/menu.interface';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  
  menuItems$: Observable<MenuItem[]>;
  sidebarState$: Observable<SidebarState>;
  expandedMenus: Set<string> = new Set();

  constructor(public layoutService: LayoutService, private router: Router) {
    this.menuItems$ = this.layoutService.menuItems$;
    this.sidebarState$ = this.layoutService.sidebarState$;
  }

  ngOnInit(): void {}

  /**
   * Basculer l'expansion d'un sous-menu (mode ACCORDÉON : ouvrir une entrée referme toutes
   * les autres — une seule reste dépliée à la fois).
   */
  toggleSubmenu(menuId: string): void {
    if (this.expandedMenus.has(menuId)) {
      this.expandedMenus.delete(menuId);
    } else {
      this.expandedMenus.clear(); // referme les autres sous-menus
      this.expandedMenus.add(menuId);
    }
  }

  /**
   * Vérifier si un menu est expandé
   */
  isExpanded(menuId: string): boolean {
    return this.expandedMenus.has(menuId);
  }

  /**
   * Clic sur une entrée de premier niveau AVEC sous-menu : bascule le dépli et, lorsqu'on
   * OUVRE le sous-menu, navigue automatiquement vers sa PREMIÈRE sous-entrée. En refermant,
   * on ne navigue pas.
   */
  openSubmenu(item: MenuItem): void {
    const willOpen = !this.isExpanded(item.id);
    this.toggleSubmenu(item.id);
    if (willOpen) {
      const firstRoute = item.children?.[0]?.route;
      if (firstRoute) {
        this.router.navigate([firstRoute]);
      }
    }
  }

  /**
   * Après l'ouverture d'une entrée du menu, réduire le sidebar (mode compact).
   * Appelé uniquement sur les liens de navigation (feuilles), pas sur l'ouverture d'un sous-menu.
   */
  onNavigate(): void {
    this.layoutService.collapseSidebar();
  }

  /**
   * Naviguer vers une route
   */
  navigateTo(route?: string): void {
    if (route) {
      console.log(`🚀 Navigation vers: ${route}`);
      // TODO: Implémenter la navigation réelle avec Router
    }
  }
}
