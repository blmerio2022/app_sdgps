import { BehaviorSubject, of } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { ProjectFlatListComponent } from './project-flat-list.component';
import { colonnesDe, triablesDe } from './project-flat-list.config';

describe('ProjectFlatListComponent (logique)', () => {
  let cmp: ProjectFlatListComponent;
  let service: jasmine.SpyObj<any>;
  let router: jasmine.SpyObj<any>;
  let qp$: BehaviorSubject<any>;
  const route: any = { snapshot: { data: { niveau: 'session' }, paramMap: convertToParamMap({ id: 'p1' }) } };

  const SESSIONS = [
    { id: 's1', numero_session: 2, ssdgps: 'g1', ssdgps_numero: 3, affaire: 'a1', affaire_numero: 1, propriete: 'pr1', propriete_id_titre: 'T1/A', nbr_total_pieces: 4 },
    { id: 's2', numero_session: 1, ssdgps: 'g1', ssdgps_numero: 3, affaire: 'a1', affaire_numero: 1, propriete: 'pr1', propriete_id_requisition: 'R2/1', nbr_total_pieces: 0 },
  ];

  beforeEach(() => {
    service = jasmine.createSpyObj('ProjectsService', ['listSessions', 'listAffaires', 'getProprietes', 'getProjet', 'getPropriete',
      'deleteSession', 'bulkRestoreSessions', 'bulkPermanentDeleteSessions']);
    service.listSessions.and.callFake((p: any) => of(p.show_deleted ? [] : SESSIONS));
    service.getProjet.and.returnValue(of({ id: 'p1', code_projet: 'P1', nom_projet: 'Projet 1' }));
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.url = '/projets/p1/sessions';
    qp$ = new BehaviorSubject(convertToParamMap({ affaire: 'a1' }));
    route.queryParamMap = qp$;
    route.snapshot.data = { niveau: 'session' };
    const cfg = { get: () => of([]), save: (_k: string, v: any) => of(v), resetToSource: () => of([]) };
    cmp = new ProjectFlatListComponent(service, jasmine.createSpyObj('Toast', ['success', 'error']), route, router,
      jasmine.createSpyObj('Breadcrumb', ['set', 'clear']), cfg as any, cfg as any);
    cmp.ngOnInit();
  });

  afterEach(() => cmp.ngOnDestroy());

  it('charge les sessions de la portée la plus fine', () => {
    expect(service.listSessions).toHaveBeenCalledWith({ affaire: 'a1' });
    expect(service.listSessions).toHaveBeenCalledWith({ affaire: 'a1', show_deleted: true });
    expect(cmp.activeCount).toBe(2);
    expect(cmp.porteeLabel).toContain('Affaire SD 1');
  });

  it('change de portée sans recréer le composant', () => {
    qp$.next(convertToParamMap({}));
    expect(service.listSessions).toHaveBeenCalledWith({ projet: 'p1' });
    expect(cmp.porteeLabel).toBe('');
  });

  it('libellés de cellule', () => {
    expect(cmp.getCellValue(SESSIONS[0], 'ssdgps_label')).toBe('SSDGPS n°3');
    expect(cmp.getCellValue(SESSIONS[1], 'propriete_label')).toBe('R2/1');
    expect(cmp.getCellValue(SESSIONS[0], 'affaire_numero')).toBe('SD 1');
    expect(cmp.getCellValue(SESSIONS[0], 'numero_session')).toBe('Session n°2');
  });

  it('recherche et tri multi-niveaux', () => {
    cmp.searchText = 'r2/1';
    expect(cmp.filteredItems.map(r => r.id)).toEqual(['s2']);
    cmp.searchText = '';
    cmp.sortLevels = [{ field: 'numero_session', dir: 'asc' }];
    expect(cmp.filteredItems.map(r => r.id)).toEqual(['s2', 's1']);
  });

  it('ouvrir une session mène à ses pièces', () => {
    cmp.open(SESSIONS[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/', 'projets', 'p1', 'pieces', 'g1'],
      { queryParams: { proprieteId: 'pr1', affaireId: 'a1', session: 's1' } });
  });

  it('élargir retire la portée', () => {
    cmp.elargir();
    expect(router.navigate).toHaveBeenCalledWith(['/', 'projets', 'p1', 'sessions']);
  });

  it('suppression groupée après confirmation', () => {
    service.deleteSession.and.returnValue(of(null));
    cmp.askDelete(['s1', 's2']);
    cmp.confirmAction();
    expect(service.deleteSession).toHaveBeenCalledTimes(2);
    expect(cmp.confirm).toBeNull();
  });

  it('chaque catalogue porte les 7 colonnes d’audit, masquées', () => {
    for (const n of ['propriete', 'affaire', 'session'] as const) {
      const audit = colonnesDe(n).filter(c => ['created_at', 'created_by_email', 'updated_at', 'updated_by_email', 'is_deleted', 'deleted_at', 'deleted_by_email'].includes(c.field));
      expect(audit.length).toBe(7);
      expect(audit.every(c => !c.visible)).toBeTrue();
      expect(triablesDe(n).length).toBeGreaterThan(7);
    }
  });
});
