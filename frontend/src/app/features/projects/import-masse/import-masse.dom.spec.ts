import { ComponentFixture, TestBed } from '@angular/core/testing';
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
