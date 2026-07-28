import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PermanentDeleteConfirmComponent } from './permanent-delete-confirm.component';

/** Confirmation partagée de suppression DÉFINITIVE (unitaire + masse). */
describe('PermanentDeleteConfirmComponent', () => {
  let fixture: ComponentFixture<PermanentDeleteConfirmComponent>;
  let cmp: PermanentDeleteConfirmComponent;

  const text = () => (fixture.nativeElement as HTMLElement).textContent || '';
  const panel = () => fixture.nativeElement.querySelector('.confirm-panel');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PermanentDeleteConfirmComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(PermanentDeleteConfirmComponent);
    cmp = fixture.componentInstance;
    cmp.entitySingular = 'organisme';
    cmp.entityPlural = 'organismes';
  });

  it('n’affiche rien tant qu’elle n’est pas ouverte', () => {
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('mode unitaire : nomme l’élément visé et avertit de l’irréversibilité', () => {
    cmp.open = true;
    cmp.label = 'Direction régionale';
    fixture.detectChanges();
    expect(cmp.title).toBe('Supprimer définitivement ce organisme ?');
    expect(text()).toContain('Direction régionale');
    expect(text()).toContain('irréversible');
  });

  it('mode masse : accorde le titre et le texte au nombre', () => {
    cmp.open = true; cmp.bulk = true; cmp.count = 3;
    fixture.detectChanges();
    expect(cmp.title).toBe('Supprimer définitivement 3 organismes ?');
    expect(text()).toContain('seront');

    cmp.count = 1;
    fixture.detectChanges();
    expect(cmp.title).toBe('Supprimer définitivement 1 organisme ?');
    expect(text()).toContain('sera');
  });

  it('affiche l’avertissement sur les sous-données quand il est fourni', () => {
    cmp.open = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm-note')).toBeNull();

    cmp.blockedBy = 'organismes de deuxième niveau';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm-note')).not.toBeNull();
    expect(text()).toContain('organismes de deuxième niveau');
  });

  it('le message des sous-données s’adapte au mode', () => {
    cmp.open = true; cmp.blockedBy = 'sessions';
    fixture.detectChanges();
    expect(text()).toContain('refusée');      // unitaire

    cmp.bulk = true; cmp.count = 2;
    fixture.detectChanges();
    expect(text()).toContain('conservés');    // masse
  });

  it('émet confirm et cancel', () => {
    const calls: string[] = [];
    cmp.confirm.subscribe(() => calls.push('confirm'));
    cmp.cancel.subscribe(() => calls.push('cancel'));
    cmp.open = true;
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.btn-danger') as HTMLElement).click();
    (fixture.nativeElement.querySelector('.btn-cancel') as HTMLElement).click();
    expect(calls).toEqual(['confirm', 'cancel']);
  });

  it('pendant la suppression : boutons verrouillés et aucun événement émis', () => {
    const calls: string[] = [];
    cmp.confirm.subscribe(() => calls.push('confirm'));
    cmp.cancel.subscribe(() => calls.push('cancel'));
    cmp.open = true; cmp.busy = true;
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('.btn-danger') as HTMLButtonElement).disabled).toBeTrue();
    expect(text()).toContain('Suppression…');
    cmp.onConfirm();
    cmp.onCancel();
    expect(calls).toEqual([]);
  });
});
