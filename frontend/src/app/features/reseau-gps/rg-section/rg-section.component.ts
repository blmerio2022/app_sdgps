import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

const CLE = 'reseauGps.sections';

/**
 * Section dépliable / repliable du module Réseau GPS. L'état ouvert/fermé est mémorisé par
 * `cle` dans le navigateur : l'opérateur retrouve la page telle qu'il l'a laissée.
 */
@Component({
  selector: 'app-rg-section',
  templateUrl: './rg-section.component.html',
  styleUrls: ['./rg-section.component.scss'],
})
export class RgSectionComponent implements OnInit {
  @Input() titre = '';
  @Input() icone = '';
  @Input() badge: string | number | null = null;
  @Input() cle = '';
  @Input() ouvert = true;
  @Output() ouvertChange = new EventEmitter<boolean>();

  ngOnInit(): void {
    if (!this.cle) return;
    const etats = RgSectionComponent.lireEtats();
    if (this.cle in etats) this.ouvert = etats[this.cle];
  }

  basculer(): void {
    this.ouvert = !this.ouvert;
    this.ouvertChange.emit(this.ouvert);
    if (this.cle) {
      const etats = RgSectionComponent.lireEtats();
      etats[this.cle] = this.ouvert;
      localStorage.setItem(CLE, JSON.stringify(etats));
    }
  }

  static lireEtats(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem(CLE) || '{}') || {}; } catch { return {}; }
  }
}
