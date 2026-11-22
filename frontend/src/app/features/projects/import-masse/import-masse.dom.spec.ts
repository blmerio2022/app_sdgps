import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { ImportMasseComponent } from './import-masse.component';
import { ImportMasseService } from '../../../core/services/import-masse.service';
import { PiecesService } from '../../../core/services/pieces.service';
import { PdfRenderService } from '../../../core/services/pdf-render.service';

/** Sélection RÉELLE dans le gabarit (champ fichier / dossier) : les fichiers doivent
 * apparaître, et partir à l'analyse. */
describe('ImportMasseComponent (gabarit)', () => {
  let fixture: ComponentFixture<ImportMasseComponent>;
  let svc: any;

  beforeEach(() => {
    svc = { plan: jasmine.createSpy('plan').and.returnValue(of({ plan: [], images: [], ecartes: [],
      points: { PPA: [], PPN: [] }, rc_possible: false, rc_existant: false, pieces_existantes: {} })) };
    TestBed.configureTestingModule({
      declarations: [ImportMasseComponent],
      imports: [FormsModule, RouterTestingModule],
      providers: [{ provide: ImportMasseService, useValue: svc }, { provide: PiecesService, useValue: {} },
                  { provide: PdfRenderService, useValue: {} }],
    });
    fixture = TestBed.createComponent(ImportMasseComponent);
    fixture.componentInstance.ssdgpsId = 's1';
    fixture.detectChanges();
  });

  function choisir(input: HTMLInputElement, fichiers: File[]): void {
    const dt = new DataTransfer();
    fichiers.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('champ « fichiers » : les fichiers sont listés puis envoyés à l’analyse', async () => {
    const champs = fixture.nativeElement.querySelectorAll('input[type=file]') as NodeListOf<HTMLInputElement>;
    const champFichiers = Array.from(champs).find(c => !c.hasAttribute('webkitdirectory'))!;
    choisir(champFichiers, [new File(['ID,Nom Point'], 'data-liste-points-anciens.csv'), new File(['<html>'], 'Rapport 1.html')]);
    expect(fixture.componentInstance.depots.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('1 tableau(x)');
    const bouton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(b => /Analyser/.test(b.textContent || ''))!;
    expect(bouton.disabled).toBeFalse();
    bouton.click();
    await new Promise(r => setTimeout(r, 300));
    expect(svc.plan).toHaveBeenCalled();
  });

  it('champ « dossier » : les fichiers du dossier sont listés', () => {
    const champDossier = fixture.nativeElement.querySelector('input[webkitdirectory]') as HTMLInputElement;
    expect(champDossier).withContext('champ dossier présent').toBeTruthy();
    choisir(champDossier, [new File(['x'], 'a.csv'), new File(['y'], 'b.jpg')]);
    expect(fixture.componentInstance.depots.length).toBe(2);
  });
});

/** Fenêtre de correspondance imbriquée dans le fond de l'import : ses clics ne doivent pas
 * remonter jusqu'au fond (qui fermerait tout l'import en masse). */
describe('ImportMasseComponent (fenêtre de correspondance)', () => {
  let fixture: ComponentFixture<ImportMasseComponent>;
  let cmp: ImportMasseComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ImportMasseComponent],
      imports: [FormsModule, RouterTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: ImportMasseService, useValue: {} }, { provide: PiecesService, useValue: {} },
                  { provide: PdfRenderService, useValue: {} }],
    });
    fixture = TestBed.createComponent(ImportMasseComponent);
    cmp = fixture.componentInstance;
    const ligne: any = { fichier: 'a.xlsx › Feuil3', type_piece: 'ROB', candidats: [], mapping: {} };
    cmp.correspondanceLigne = ligne;
    cmp.correspondancePreview = { columns: ['A'], preview_rows: [], total_rows: 1, champs: [] };
    fixture.detectChanges();
  });

  it('« Appliquer » et le fond ne ferment que la correspondance, jamais l’import', () => {
    // Rafraîchissement automatique, comme dans l'application : la fenêtre est détruite
    // PENDANT le clic (c'est ce qui laissait le clic remonter jusqu'au fond de l'import).
    fixture.autoDetectChanges(true);
    const fermee = spyOn(cmp.fermee, 'emit');
    const appliquer = [...fixture.nativeElement.querySelectorAll('.im-corresp-modale button')]
      .find((b: HTMLButtonElement) => /Appliquer/.test(b.textContent || '')) as HTMLButtonElement;
    appliquer.click();
    fixture.detectChanges();
    expect(cmp.correspondanceLigne).toBeNull();
    expect(fermee).not.toHaveBeenCalled();

    cmp.correspondanceLigne = { fichier: 'x', type_piece: 'ROB', candidats: [], mapping: {} } as any;
    cmp.correspondancePreview = { columns: ['A'], preview_rows: [], total_rows: 1, champs: [] };
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.im-corresp-overlay') as HTMLElement).click();
    expect(cmp.correspondanceLigne).toBeNull();
    expect(fermee).not.toHaveBeenCalled();
  });

  it('un clic SUR le fond ferme l’import', () => {
    cmp.correspondanceLigne = null;
    fixture.detectChanges();
    const fermee = spyOn(cmp.fermee, 'emit');
    (fixture.nativeElement.querySelector('.im-fond') as HTMLElement).click();
    expect(fermee).toHaveBeenCalled();
  });
});
