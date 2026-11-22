import { FormBuilder } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { PieceColumnMapperComponent } from './piece-column-mapper.component';

function fauxIa(propositions: any[] = [], disponible = true) {
  return {
    disponible$: of(disponible),
    mappingColonnes: jasmine.createSpy('mappingColonnes').and.returnValue(of({ propositions })),
  };
}

describe('PieceColumnMapperComponent (mapping)', () => {
  let cmp: PieceColumnMapperComponent;
  const fb = new FormBuilder();

  beforeEach(() => {
    cmp = new PieceColumnMapperComponent(fb, fauxIa() as any);
    cmp.champs = [{ name: 'a' } as any, { name: 'b' } as any];
    cmp.form = fb.group({ a: 'COL_A', b: '' });
    (cmp as any).originalSuggestions = { a: 'COL_A', b: '' };
  });

  it('totalChamps / mappedCount', () => {
    expect(cmp.totalChamps).toBe(2);
    expect(cmp.mappedCount).toBe(1); // seul « a » est mappé
  });

  it('previewColumns ne garde que les champs mappés', () => {
    expect(cmp.previewColumns.map(c => c.name)).toEqual(['a']);
  });

  it('isModified détecte un écart avec la suggestion d’origine', () => {
    expect(cmp.isModified('a')).toBeFalse();
    cmp.form.get('a')?.setValue('AUTRE_COL');
    expect(cmp.isModified('a')).toBeTrue();
  });
});

/** N°4 — l'IA COMPLÈTE la correspondance, sans jamais écraser un choix existant. */
describe('PieceColumnMapperComponent (compléter avec l’IA)', () => {
  const fb = new FormBuilder();

  function creer(ia: any) {
    const cmp = new PieceColumnMapperComponent(fb, ia);
    cmp.typePiece = 'ROB';
    cmp.champs = [
      { name: 'point', label: 'Point' } as any,
      { name: 'hauteur', label: 'Hauteur antenne' } as any,
      { name: 'antenne', label: 'Antenne' } as any,
    ];
    cmp.preview = { columns: ['Point', 'HI', 'Ant. Type'], preview_rows: [['BT10', '1.36', 'TRM']],
                    total_rows: 1, champs: [] };
    cmp.ngOnInit();
    cmp.ngOnChanges({ champs: {} as any });
    return cmp;
  }

  it('n’est proposé que si l’IA est activée', () => {
    expect(creer(fauxIa([], false)).iaDisponible).toBeFalse();
    expect(creer(fauxIa()).iaDisponible).toBeTrue();
  });

  it('envoie les associations déjà faites et pose seulement les manquantes, avec badge', () => {
    const ia = fauxIa([
      { champ: 'hauteur', colonne: 'HI', confiance: 'moyenne', raison: 'HI = hauteur instrument.' },
      { champ: 'point', colonne: 'Ant. Type', confiance: 'haute', raison: 'ne doit pas écraser' },
    ]);
    const cmp = creer(ia);
    expect(cmp.form.value.point).toBe('Point');              // correspondance automatique

    cmp.completerAvecIa();

    const [type, colonnes, lignes, deja] = ia.mappingColonnes.calls.mostRecent().args;
    expect(type).toBe('ROB');
    expect(colonnes).toEqual(['Point', 'HI', 'Ant. Type']);
    expect(lignes).toEqual([['BT10', '1.36', 'TRM']]);
    expect(deja).toEqual({ point: 'Point' });
    expect(cmp.form.value.hauteur).toBe('HI');
    expect(cmp.form.value.point).toBe('Point');              // jamais écrasé
    expect(cmp.suggestionIa('hauteur')?.confiance).toBe('moyenne');
    expect(cmp.iaMessage).toContain('1 association');
  });

  it('le badge disparaît dès que l’opérateur change la colonne', () => {
    const cmp = creer(fauxIa([{ champ: 'hauteur', colonne: 'HI', confiance: 'haute', raison: 'r' }]));
    cmp.completerAvecIa();
    expect(cmp.suggestionIa('hauteur')).toBeTruthy();
    cmp.form.get('hauteur')?.setValue('Ant. Type');
    expect(cmp.suggestionIa('hauteur')).toBeNull();
  });

  it('ignore une colonne inconnue du fichier', () => {
    const cmp = creer(fauxIa([{ champ: 'hauteur', colonne: 'Inventée', confiance: 'haute', raison: 'r' }]));
    cmp.completerAvecIa();
    expect(cmp.form.value.hauteur).toBeFalsy();
    expect(cmp.iaMessage).toContain('aucune association');
  });

  it('affiche l’erreur du serveur', () => {
    const ia = fauxIa();
    ia.mappingColonnes.and.returnValue(throwError(() => ({ status: 502, error: { detail: 'Service saturé' } })));
    const cmp = creer(ia);
    cmp.completerAvecIa();
    expect(cmp.iaErreur).toBe('Service saturé');
    expect(cmp.iaEnCours).toBeFalse();
  });

  it('rien à compléter : pas d’appel', () => {
    const ia = fauxIa();
    const cmp = creer(ia);
    cmp.form.patchValue({ hauteur: 'HI', antenne: 'Ant. Type' });
    expect(cmp.peutCompleterAvecIa).toBeFalse();
    cmp.completerAvecIa();
    expect(ia.mappingColonnes).not.toHaveBeenCalled();
  });
});

/** Correspondance proposée par le serveur (synonymes des exports réels) et départ imposé. */
describe('PieceColumnMapperComponent (proposition du serveur)', () => {
  const fb = new FormBuilder();
  const champs = [{ name: 'point', label: 'Point' }, { name: 'haut_ant_m', label: 'Haut. Ant. (m)' },
                  { name: 'antenne', label: 'Antenne' }] as any[];
  const preview = { columns: ['ID du point', 'Hauteur ant.', 'Type ant.'], preview_rows: [], total_rows: 0, champs } as any;

  function construire(propose: any, initial: any = null): PieceColumnMapperComponent {
    const cmp = new PieceColumnMapperComponent(fb, fauxIa([], false) as any);
    Object.assign(cmp, { champs, preview, mappingPropose: propose, mappingInitial: initial });
    cmp.ngOnChanges({ champs: {} as any });
    return cmp;
  }

  it('part de la proposition du serveur, que la correspondance par nom ne trouverait pas', () => {
    const cmp = construire({ point: 'ID du point', haut_ant_m: 'Hauteur ant.', antenne: 'Type ant.' });
    expect(cmp.form.value).toEqual({ point: 'ID du point', haut_ant_m: 'Hauteur ant.', antenne: 'Type ant.' });
    expect(cmp.isModified('point')).toBeFalse();
  });

  it('ignore une colonne proposée absente du fichier', () => {
    const cmp = construire({ point: 'Colonne fantôme' });
    expect(cmp.form.value.point).not.toBe('Colonne fantôme');
  });

  it('un départ imposé (choix déjà ajusté) prime ; « Réinitialiser » revient à la proposition', () => {
    const cmp = construire({ point: 'ID du point', antenne: 'Type ant.' }, { point: 'ID du point', antenne: '' });
    expect(cmp.form.value.antenne).toBe('');
    expect(cmp.isModified('antenne')).toBeTrue();
    cmp.resetAllToSuggestions();
    expect(cmp.form.value.antenne).toBe('Type ant.');
  });
});
