import { of, throwError } from 'rxjs';
import { ModeleSsdgpsEditorComponent, piecesParDefaut, typesApplicables } from './modele-ssdgps-editor.component';

const CATALOG: any[] = [
  { code: 'PGSDGPS', nom: 'Page de garde', source: 'ui', natures: 'toutes', repeatable: false },
  { code: 'LPA', nom: 'Liste des points anciens', source: 'csv_manuel', natures: ['PDC/GPS', 'DLC/GPS'], repeatable: false },
  { code: 'RDN', nom: 'Rapport de la détermination N°k', source: 'csv_manuel', natures: ['PDC/GPS'], repeatable: true },
  { code: 'RDI', nom: 'Rapport des déterminations', source: 'csv_manuel', natures: ['DLC/GPS'], repeatable: false },
  { code: 'RDC', nom: 'Rapport de consultation', source: 'image', natures: 'toutes', repeatable: false },
];

describe('ModeleSsdgpsEditorComponent (logique)', () => {
  let cmp: ModeleSsdgpsEditorComponent;
  let service: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    service = jasmine.createSpyObj('ModelesSsdgpsService', ['create', 'update']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    cmp = new ModeleSsdgpsEditorComponent(service, toast);
    cmp.catalog = CATALOG;
  });

  it('typesApplicables écarte les pièces générées et non applicables', () => {
    expect(typesApplicables(CATALOG, 'PDC/GPS').map(d => d.code)).toEqual(['LPA', 'RDN', 'RDC']);
  });

  it('piecesParDefaut donne le n°1 aux types répétables', () => {
    const p = piecesParDefaut(CATALOG, 'PDC/GPS');
    expect(p.find(x => x.type_piece === 'RDN')?.numero).toBe(1);
    expect(p.find(x => x.type_piece === 'LPA')?.numero).toBeNull();
  });

  it('à la création, part des pièces par défaut de la nature proposée', () => {
    cmp.defaultNature = 'DLC/GPS';
    cmp.ngOnInit();
    expect(cmp.isNew).toBeTrue();
    expect(cmp.pieces.map(p => p.type_piece)).toEqual(['LPA', 'RDI', 'RDC']);
  });

  it('en modification, reprend le modèle sans le muter', () => {
    const modele: any = { id: 'm1', nom: 'X', nature_ssdgps: 'PDC/GPS', type_ssdgps: 'multi-session', portee: 'personnel',
      pieces: [{ type_piece: 'LPA', numero: null, obligatoire: true }] };
    cmp.modele = modele;
    cmp.ngOnInit();
    cmp.pieces[0].obligatoire = false;
    expect(modele.pieces[0].obligatoire).toBeTrue();
    expect(cmp.typeSsdgps).toBe('multi-session');
  });

  it('add() numérote le répétable suivant et respecte l’ordre du catalogue', () => {
    cmp.ngOnInit();                       // PDC : LPA, RDN 1, RDC
    cmp.add(CATALOG[2]);                  // RDN
    expect(cmp.pieces.filter(p => p.type_piece === 'RDN').map(p => p.numero)).toEqual([1, 2]);
    expect(cmp.pieces.map(p => p.type_piece)).toEqual(['LPA', 'RDN', 'RDN', 'RDC']);
  });

  it('available masque un type non répétable déjà présent, garde le répétable', () => {
    cmp.ngOnInit();
    const codes = cmp.available.map(d => d.code);
    expect(codes).not.toContain('LPA');
    expect(codes).toContain('RDN');
  });

  it('move / remove / toggleObligatoire', () => {
    cmp.ngOnInit();
    cmp.move(0, 1);
    expect(cmp.pieces[1].type_piece).toBe('LPA');
    cmp.move(0, -1);                      // hors bornes : sans effet
    expect(cmp.pieces[0].type_piece).toBe('RDN');
    cmp.toggleObligatoire(cmp.pieces[0]);
    expect(cmp.obligatoires).toBe(2);
    cmp.remove(0);
    expect(cmp.pieces.length).toBe(2);
  });

  it('setNature écarte les pièces non applicables et le signale', () => {
    cmp.ngOnInit();                       // PDC
    cmp.setNature('DLC/GPS');
    expect(cmp.dropped).toEqual(['RDN']);
    expect(cmp.pieces.map(p => p.type_piece)).toEqual(['LPA', 'RDC']);
  });

  it('label() remplace N°k par le numéro', () => {
    expect(cmp.label({ type_piece: 'RDN', numero: 3, obligatoire: true })).toBe('Rapport de la détermination N°3');
  });

  it('canSave exige un nom et au moins une pièce', () => {
    cmp.ngOnInit();
    expect(cmp.canSave).toBeFalse();
    cmp.nom = 'Mon modèle';
    expect(cmp.canSave).toBeTrue();
    cmp.pieces = [];
    expect(cmp.canSave).toBeFalse();
  });

  it('save() crée avec la portée et sans les libellés', () => {
    cmp.ngOnInit();
    cmp.nom = ' Mon modèle ';
    service.create.and.returnValue(of({ id: 'm9', nom: 'Mon modèle' }));
    const saved = jasmine.createSpy('saved');
    cmp.saved.subscribe(saved);
    cmp.save();
    const body = service.create.calls.mostRecent().args[0];
    expect(body.nom).toBe('Mon modèle');
    expect(body.portee).toBe('personnel');
    expect(Object.keys(body.pieces[0])).toEqual(['type_piece', 'numero', 'obligatoire']);
    expect(saved).toHaveBeenCalled();
  });

  it('save() en modification passe par update et n’envoie pas la portée', () => {
    cmp.modele = { id: 'm1', nom: 'X', nature_ssdgps: 'PDC/GPS', type_ssdgps: 'mono-session', portee: 'systeme',
      pieces: [{ type_piece: 'LPA', numero: null, obligatoire: true }] } as any;
    cmp.ngOnInit();
    service.update.and.returnValue(of({ id: 'm1', nom: 'X' }));
    cmp.save();
    expect(service.update.calls.mostRecent().args[0]).toBe('m1');
    expect(service.update.calls.mostRecent().args[1].portee).toBeUndefined();
  });

  it('save() affiche l’erreur du serveur', () => {
    cmp.ngOnInit();
    cmp.nom = 'X';
    service.create.and.returnValue(throwError(() => ({ error: { pieces: ['Type inconnu.'] } })));
    cmp.save();
    expect(cmp.error).toContain('Type inconnu.');
    expect(cmp.saving).toBeFalse();
  });
});
