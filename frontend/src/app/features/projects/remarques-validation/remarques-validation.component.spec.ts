import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { EtatRemarques, QualiteDossierService, Remarque } from '../../../core/services/qualite-dossier.service';
import { RemarquesValidationComponent } from './remarques-validation.component';

const R = (id: string, p: Partial<Remarque> = {}): Remarque => ({
  id, piece: 'p1', piece_libelle: 'RDIA', ligne: 'BT11', texte: 'σ incohérent', statut: 'ouverte',
  statut_display: 'À corriger', reponse: '', auteur: 'Chef', created_at: '2026-11-18T10:00:00Z',
  corrigee_par: '', corrigee_at: null, levee_par: '', levee_at: null, peut_supprimer: false, ...p,
});
const ETAT = (p: Partial<EtatRemarques> = {}): EtatRemarques => ({
  remarques: [R('r1'), R('r2', { piece: null, piece_libelle: '', statut: 'corrigee', statut_display: 'Corrigée', reponse: 'fait' })],
  ouvertes: 1, corrigees: 1, levees: 0, peut_remarquer: false, peut_lever: false, peut_corriger: true, ...p,
});

describe('RemarquesValidationComponent', () => {
  let fixture: ComponentFixture<RemarquesValidationComponent>;
  let cmp: RemarquesValidationComponent;
  let svc: jasmine.SpyObj<QualiteDossierService>;

  function creer(etat = ETAT(), pieceInitiale: string | null = null): HTMLElement {
    svc = jasmine.createSpyObj('QualiteDossierService', ['remarques', 'ajouterRemarque', 'operationRemarque', 'supprimerRemarque']);
    svc.remarques.and.returnValue(of(etat));
    TestBed.configureTestingModule({
      declarations: [RemarquesValidationComponent], imports: [FormsModule],
      providers: [{ provide: QualiteDossierService, useValue: svc },
                  { provide: Router, useValue: { url: '/projets/x', navigate: jasmine.createSpy() } }],
    });
    fixture = TestBed.createComponent(RemarquesValidationComponent);
    cmp = fixture.componentInstance;
    Object.assign(cmp, { ssdgpsId: 's1', projetId: 'pr1', pieces: [{ id: 'p1', libelle: 'RDIA' }], pieceInitiale });
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('affiche compteurs, remarques et réponse ; formulaire réservé à l’encadrement', () => {
    const el = creer();
    expect(el.textContent).toContain('1 à corriger');
    expect(el.querySelectorAll('.rv-item').length).toBe(2);
    expect(el.textContent).toContain('fait');
    expect(el.querySelector('.rv-form')).toBeNull();
  });

  it('filtre par statut et par pièce ; filtre initial sur la pièce ouverte', () => {
    creer(ETAT(), 'p1');
    expect(cmp.visibles.map(r => r.id)).toEqual(['r1']);
    cmp.filtrePiece = 'dossier';
    expect(cmp.visibles.map(r => r.id)).toEqual(['r2']);
    cmp.filtrePiece = 'toutes';
    cmp.filtreStatut = 'corrigee';
    expect(cmp.visibles.map(r => r.id)).toEqual(['r2']);
  });

  it('encadrement : ajoute une remarque sur une pièce et une ligne', () => {
    creer(ETAT({ peut_remarquer: true }));
    const emis = spyOn(cmp.changement, 'emit');
    svc.ajouterRemarque.and.returnValue(of(ETAT({ ouvertes: 2 })));
    Object.assign(cmp, { texte: ' Point manquant ', pieceChoisie: 'p1', ligne: 'GPS1' });
    cmp.ajouter();
    expect(svc.ajouterRemarque).toHaveBeenCalledWith('s1', 'Point manquant', 'p1', 'GPS1');
    expect(cmp.texte).toBe('');
    expect(emis).toHaveBeenCalled();
  });

  it('rédacteur : marque corrigée avec sa réponse', () => {
    creer();
    svc.operationRemarque.and.returnValue(of(ETAT({ ouvertes: 0, corrigees: 2 })));
    cmp.ouvrirCorrection(cmp.visibles[0]);
    cmp.reponse = 'σ recalculé';
    cmp.operation(cmp.visibles[0], 'corriger');
    expect(svc.operationRemarque).toHaveBeenCalledWith('s1', 'r1', 'corriger', 'σ recalculé');
    expect(cmp.enCorrection).toBeNull();
  });

  it('affiche le refus du serveur', () => {
    creer();
    svc.operationRemarque.and.returnValue(throwError(() => ({ error: { detail: 'Réservé à l’encadrement du dossier.' } })));
    cmp.operation(cmp.visibles[0], 'lever');
    expect(cmp.erreur).toBe('Réservé à l’encadrement du dossier.');
    expect(cmp.envoi).toBeFalse();
  });
});
