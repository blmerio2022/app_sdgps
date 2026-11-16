import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { ImportMasseComponent } from './import-masse.component';
import { ImportMasseService, dossiersFilesManquants, lireDossiersFiles, lireEntree, utile } from '../../../core/services/import-masse.service';
import { environment } from '../../../../environments/environment';

const C = (type: string, over: any = {}): any => ({ type_piece: type, libelle: type, score: 1, champs_reconnus: 5, champs_total: 5,
  nom_reconnu: false, repetable: false, niveau: 'ssdgps', mapping: { a: 'A' }, numero_nom: null, ...over });
const L = (over: any = {}): any => ({ index: 0, fichier: 'l/LPA.csv', mode: 'tableau', lisible: true, colonnes: ['A'], lignes: 3,
  candidats: [C('LPA')], type_piece: 'LPA', mapping: { a: 'A' }, numero: null, piece_existante: null, action: 'creer', ...over });
const IMG = (index: number, type: string | null, point = '', ref = point ? '1' : ''): any => ({ index, fichier: `l/${index}.jpg`, nature_image: 'photo', point_ref: ref,
  type_piece: type, point, raison: '' });

describe('ImportMasseService', () => {
  it('plan avec chemins, tableau d’une feuille, rapport HTML sans lignes, remplacement', () => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const svc = TestBed.inject(ImportMasseService);
    const http = TestBed.inject(HttpTestingController);
    const base = `${environment.apiUrl}/v1/pieces/`;
    svc.plan('s1', [{ fichier: new File(['x'], 'a.html'), chemin: 'l/R 1_files/a.html' }]).subscribe();
    const p = http.expectOne(`${base}import-plan/`).request.body as FormData;
    expect(p.get('chemins')).toBe('["l/R 1_files/a.html"]');
    svc.importer('s1', new File(['x'], 'c.xlsx'), L({ feuille: 'Obs', type_piece: 'ROB' }), null).subscribe();
    expect((http.expectOne(`${base}import/`).request.body as FormData).get('feuille')).toBe('Obs');
    svc.importerHtml('s1', new File(['x'], 'a.html'), L({ mode: 'html', type_piece: 'RDN', numero: 3 }), null).subscribe();
    const h = http.expectOne(`${base}import-html/`).request.body as FormData;
    expect([h.get('numero'), h.has('payload')]).toEqual(['3', false]);
    svc.remplacerLignes('rc1', [{ a: 1 }]).subscribe();
    expect(http.expectOne(`${base}rc1/`).request.method).toBe('PATCH');
    http.verify();
  });

  it('formats utiles et lecture récursive d’un dossier déposé', async () => {
    expect(utile('l/x.csv')).toBeTrue();
    expect(utile('l/R_files/saved_resource.html')).toBeFalse();
    expect(utile('l/notes.docx')).toBeFalse();
    const fichier = (nom: string) => ({ isFile: true, file: (ok: any) => ok(new File(['x'], nom)) });
    let lu = false;
    const dossier = { isDirectory: true, name: 'levé', createReader: () => ({
      readEntries: (ok: any) => { const lot = lu ? [] : [fichier('a.csv'), fichier('b.jpg')]; lu = true; ok(lot); } }) };
    const tout = await lireEntree(dossier);
    expect(tout.map(d => d.chemin)).toEqual(['levé/a.csv', 'levé/b.jpg']);
  });
});

describe('ImportMasseComponent', () => {
  let svc: any;
  let pieces: any;
  let pdf: any;
  let cmp: ImportMasseComponent;
  const csv = new File(['x'], 'LPA.csv');
  const html = new File(['y'], 'x.html');
  const photo = new File(['z'], 'GPS1.jpg');
  const photo2 = new File(['w'], 'GPS1b.jpg');
  const canevas = new File(['v'], 'canevas.png');

  beforeEach(() => {
    svc = {
      plan: jasmine.createSpy('plan').and.returnValue(of({ plan: [
        L(), L({ index: 1, fichier: 'l/R 2_files/x.html', mode: 'html', nom_rapport: 'R 2', type_piece: 'RDN', numero: 2,
                 candidats: [C('RDN', { repetable: true, niveau: 'session' }), C('RDD')], mapping: {} })],
        images: [IMG(2, 'PPA', 'GPS1'), IMG(3, 'PPA', 'GPS1'), { ...IMG(4, 'CCSPA'), nature_image: 'plan' }, IMG(5, null)],
        ecartes: [{ fichier: 'l/R 2.html', raison: 'Page-cadre' }], points: { PPA: [{ nom: 'GPS1', cle: '1' }, { nom: 'BT10', cle: '2' }], PPN: [{ nom: 'S9', cle: '1' }] },
        rc_possible: true, rc_existant: false, pieces_existantes: { CCSPA: 'can1' } })),
      importer: jasmine.createSpy('importer').and.returnValue(of({ id: 'lpa1' })),
      importerHtml: jasmine.createSpy('importerHtml').and.returnValue(of({ id: 'rdn2' })),
      remplacerLignes: jasmine.createSpy('remplacer').and.returnValue(of({})),
    };
    pieces = {
      createImagePiece: jasmine.createSpy('creerImage').and.returnValue(of({ id: 'ppa1' })),
      addImages: jasmine.createSpy('addImages').and.returnValue(of({})),
      previewComputeRc: jasmine.createSpy('apercuRc').and.returnValue(of({ rows: [{}, {}], source: 'rdn' })),
      confirmComputeRc: jasmine.createSpy('rc').and.returnValue(of({ id: 'rc1' })),
    };
    pdf = { open: jasmine.createSpy('open').and.returnValue(Promise.resolve({ numPages: 2,
      renderPage: () => Promise.resolve(document.createElement('canvas')), destroy: () => {} })) };
    cmp = new ImportMasseComponent(svc, pieces, pdf);
    cmp.ssdgpsId = 's1';
  });

  function deposer(): void {
    cmp.ajouterDepots([{ fichier: csv, chemin: 'l/LPA.csv' }, { fichier: html, chemin: 'l/R 2_files/x.html' },
                       { fichier: photo, chemin: 'l/GPS1.jpg' }, { fichier: photo2, chemin: 'l/GPS1b.jpg' },
                       { fichier: canevas, chemin: 'l/canevas.png' }, { fichier: new File(['u'], 'u.jpg'), chemin: 'l/u.jpg' },
                       { fichier: new File(['d'], 'x.docx'), chemin: 'l/x.docx' }, { fichier: csv, chemin: 'l/LPA.csv' }]);
  }

  it('dépôt : formats inutiles et doublons écartés, résumé par nature', () => {
    deposer();
    expect(cmp.depots.length).toBe(6);
    expect(cmp.ignoresAuDepot).toBe(1);
    expect(cmp.resumeDepot).toEqual({ tableaux: 1, html: 1, images: 4, pdf: 0 });
  });

  it('analyse : plan, images, RC proposé ; images d’une photo sans point', () => {
    deposer();
    cmp.analyser();
    expect(cmp.etape).toBe('plan');
    expect(cmp.genererRc).toBeTrue();
    expect(cmp.imagesRetenues.length).toBe(3);
    cmp.changerTypeImage(cmp.images[3], 'PPN');
    expect(cmp.pointsDe('PPN')).toEqual([{ nom: 'S9', cle: '1' }]);
    cmp.changerPointImage(cmp.images[3], '1');
    expect(cmp.images[3].point).toBe('S9');
    cmp.changerPointImage(cmp.images[3], '');
    expect(cmp.imagesSansPoint).toBe(1);
    expect(cmp.pret).toBeTrue();
  });

  it('import : pièces, puis images par point dans la bonne pièce, puis rapport de contrôle', () => {
    deposer();
    cmp.analyser();
    const fini = spyOn(cmp.termine, 'emit');
    cmp.importer();
    expect(svc.importer).toHaveBeenCalledWith('s1', csv, cmp.plan[0], null);
    expect(svc.importerHtml).toHaveBeenCalledWith('s1', html, cmp.plan[1], null);
    // Photos de GPS1 : un seul envoi, rattaché à la CLÉ du point (ID de ligne « 1 »), pas à son nom.
    expect(pieces.createImagePiece).toHaveBeenCalledWith('PPA', { ssdgps: 's1' });
    expect(pieces.addImages).toHaveBeenCalledWith('ppa1', [photo, photo2], '1');
    // Canevas : ajouté à la pièce CCSPA existante.
    expect(pieces.addImages).toHaveBeenCalledWith('can1', [canevas], undefined);
    expect(pieces.confirmComputeRc).toHaveBeenCalled();
    expect(cmp.etape).toBe('fin');
    expect(fini).toHaveBeenCalledWith(5);
  });

  it('RC existant : recalculé dans la pièce existante ; un échec n’arrête pas la suite', () => {
    deposer();
    svc.plan.and.returnValue(of({ plan: [L()], images: [], ecartes: [], points: { PPA: [], PPN: [] },
                                  rc_possible: true, rc_existant: true, pieces_existantes: { RC: 'rc0' } }));
    svc.importer.and.returnValue(throwError(() => ({ error: { detail: 'Dossier figé' } })));
    cmp.analyser();
    cmp.importer();
    expect(cmp.resultats[0]).toEqual({ fichier: 'l/LPA.csv', ok: false, detail: 'Dossier figé' });
    expect(svc.remplacerLignes).toHaveBeenCalledWith('rc0', [{}, {}]);
  });

  it('session requise en multi-session pour une pièce de niveau session', () => {
    deposer();
    cmp.multiSession = true;
    cmp.analyser();
    expect(cmp.blocage(cmp.plan[1], 1)).toBe('Session requise');
    cmp.sessionParLigne[1] = 'sess';
    expect(cmp.blocage(cmp.plan[1], 1)).toBe('');
  });

  it('PDF : chaque page devient une image du même dossier avant l’analyse', async () => {
    cmp.ajouterDepots([{ fichier: new File(['%PDF'], 'consultation.pdf'), chemin: 'l/01-rapport-consultation/consultation.pdf' }]);
    expect(cmp.resumeDepot.pdf).toBe(1);
    await cmp.convertirPdf();
    expect(cmp.depots.map(d => d.chemin)).toEqual(['l/01-rapport-consultation/consultation-p1.jpg',
                                                   'l/01-rapport-consultation/consultation-p2.jpg']);
    expect(cmp.pagesPdf).toBe(2);
  });

  it('page-cadre sans son dossier _files : signalée, ajout du dossier puis nouvelle analyse', () => {
    deposer();
    svc.plan.and.returnValue(of({ plan: [L({ mode: 'html', cadre: true, lisible: false, nom_rapport: 'Rapport 1',
                                             type_piece: null, action: 'ignorer' })],
                                  images: [], ecartes: [], points: { PPA: [], PPN: [] }, rc_possible: false,
                                  rc_existant: false, pieces_existantes: {} }));
    cmp.analyser();
    expect(cmp.cadresSansDonnees.length).toBe(1);
    const dossier = new File(['<html>'], 'x.html');
    Object.defineProperty(dossier, 'webkitRelativePath', { value: 'Rapport 1_files/x.html' });
    cmp.ajouterDossiersManquants([dossier] as any);
    expect(cmp.depots.some(d => d.chemin === 'Rapport 1_files/x.html')).toBeTrue();
    expect(svc.plan).toHaveBeenCalledTimes(2);
  });

  it('déterminations : séparées par défaut, assemblées → une seule RDIA construite, sans RDN', () => {
    deposer();
    svc.assemblerRdia = jasmine.createSpy('assembler').and.returnValue(of({ id: 'rdia1' }));
    svc.plan.and.returnValue(of({ plan: [
        L({ index: 1, mode: 'html', type_piece: 'RDL', candidats: [C('RDL')], mapping: {}, donnees: [{ nom_point: 'A' }] }),
        L({ index: 1, mode: 'html', type_piece: 'RDN', numero: 2, candidats: [C('RDN', { repetable: true })], mapping: {}, donnees: [{ nom_point: 'B' }] }),
        L({ index: 1, mode: 'html', type_piece: 'RDN', numero: 1, candidats: [C('RDN', { repetable: true })], mapping: {}, donnees: [{ nom_point: 'C' }] })],
      images: [], ecartes: [], points: { PPA: [], PPN: [] }, rc_possible: false, rc_existant: false, pieces_existantes: {} }));
    cmp.analyser();
    expect(cmp.choixDeterminations).toBeTrue();
    expect(cmp.modeDeterminations).toBe('separees');
    expect(cmp.aImporter).toBe(3);
    cmp.modeDeterminations = 'assemblees';
    cmp.appliquerModeDeterminations();
    expect(cmp.aImporter).toBe(1);                        // la RDL seule ; les n°k partent dans la RDIA
    expect(cmp.sourcesAssemblage().map(s => s.label)).toEqual(['Libre', 'N°1', 'N°2']);
    cmp.importer();
    expect(svc.importerHtml).toHaveBeenCalledTimes(1);
    expect(svc.assemblerRdia).toHaveBeenCalledWith('s1', cmp.sourcesAssemblage(), undefined);
    cmp.modeDeterminations = 'separees';
    cmp.appliquerModeDeterminations();
    expect(cmp.aImporter).toBe(3);
  });

  it('dossiers _files : manquants détectés, puis lus dans le dossier autorisé', async () => {
    const f = (nom: string, chemin: string) => ({ fichier: new File(['x'], nom), chemin });
    const manquants = dossiersFilesManquants([f('Rapport 1.html', 'levé/Rapport 1.html'), f('Rapport 2.html', 'levé/Rapport 2.html'),
                                              f('x.html', 'levé/Rapport 2_files/x.html'), f('a.csv', 'levé/a.csv')]);
    expect(Array.from(manquants.entries()).map(([d, n]) => [d, Array.from(n)])).toEqual([['levé/', ['Rapport 1']]]);
    const fichier = (nom: string) => ({ kind: 'file', getFile: () => Promise.resolve(new File(['y'], nom)) });
    const iter = (entrees: [string, any][]) => ({ entries: async function* () { yield* entrees; } });
    const racine = iter([['Rapport 1_files', { kind: 'directory', ...iter([['abc.html', fichier('abc.html')]]) }],
                         ['autre', { kind: 'directory', ...iter([]) }], ['Rapport 1.html', fichier('Rapport 1.html')]]);
    const lus = await lireDossiersFiles(racine, new Set(['Rapport 1']), 'levé/');
    expect(lus.map(d => d.chemin)).toEqual(['levé/Rapport 1_files/abc.html']);
  });
});
