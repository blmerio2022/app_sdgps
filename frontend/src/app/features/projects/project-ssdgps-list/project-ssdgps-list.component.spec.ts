import { FormBuilder } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { ProjectSsdgpsListComponent } from './project-ssdgps-list.component';

describe('ProjectSsdgpsListComponent (tri & libellés)', () => {
  let cmp: ProjectSsdgpsListComponent;

  beforeEach(() => {
    cmp = new ProjectSsdgpsListComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, new FormBuilder(),
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any);
  });

  it('activeCount = nombre d’éléments actifs', () => {
    (cmp as any).activeItems = [{ id: '1' }, { id: '2' }];
    expect(cmp.activeCount).toBe(2);
  });

  it('sortLevelOf / sortDirOf lisent les niveaux de tri', () => {
    (cmp as any).sortLevels = [{ field: 'nature_ssdgps', dir: 'asc' }];
    expect(cmp.sortLevelOf('nature_ssdgps')).toBe(1);
    expect(cmp.sortDirOf('nature_ssdgps')).toBe('asc');
    expect(cmp.sortLevelOf('inconnu')).toBe(0);
    expect(cmp.sortDirOf('inconnu')).toBe('');
  });

  // La modale (ajout/retrait/déplacement/effacement/résumé) est désormais dans le composant
  // partagé <app-multi-level-sort> (testé séparément). Ici : branchements du parent.
  it('onSortLevelsChange applique les niveaux reçus de la modale partagée', () => {
    spyOn<any>(cmp, 'queueSaveSort'); // évite le timer d'enregistrement auto
    cmp.onSortLevelsChange([{ field: 'nature_ssdgps', dir: 'desc' }] as any);
    expect((cmp as any).sortLevels).toEqual([{ field: 'nature_ssdgps', dir: 'desc' }]);
  });

  it('openSortConfigFromContext ferme le menu contextuel et ouvre la modale de tri', () => {
    const open = jasmine.createSpy('open');
    (cmp as any).sortCmp = { open };
    cmp.showColumnContextMenu = true;
    cmp.openSortConfigFromContext();
    expect(cmp.showColumnContextMenu).toBeFalse();
    expect(open).toHaveBeenCalled();
  });
});

describe('ProjectSsdgpsListComponent (consulter / modifier / supprimer)', () => {
  let cmp: ProjectSsdgpsListComponent;
  let service: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    service = jasmine.createSpyObj('ProjectsService', ['updateSsdgps', 'deleteSsdgps']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    cmp = new ProjectSsdgpsListComponent(
      service, toast, {} as any, {} as any, {} as any, {} as any, new FormBuilder(),
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any);
    spyOn(cmp, 'load');
  });

  const ssdgps = (over: any = {}) => ({ id: 's1', numero_ssdgps: 3, nature_ssdgps: 'rattachement', type_ssdgps: 'mono-session', is_deleted: false, ...over });

  it('openDetail / closeDetail', () => {
    cmp.openDetail(ssdgps() as any, new Event('c'));
    expect(cmp.showDetailModal).toBeTrue();
    expect(cmp.detailTarget?.id).toBe('s1');
    cmp.closeDetail();
    expect(cmp.showDetailModal).toBeFalse();
  });

  it('openEdit initialise le formulaire depuis l’élément', () => {
    cmp.openEdit(ssdgps({ nature_ssdgps: 'morcellement' }) as any, new Event('c'));
    expect(cmp.showEditModal).toBeTrue();
    expect(cmp.editForm.value).toEqual({ nature_ssdgps: 'morcellement', numero_ssdgps: 3, type_ssdgps: 'mono-session' });
  });

  it('submitEdit appelle updateSsdgps puis recharge', () => {
    service.updateSsdgps.and.returnValue(of({}));
    cmp.openEdit(ssdgps() as any, new Event('c'));
    cmp.submitEdit();
    expect(service.updateSsdgps).toHaveBeenCalledWith('s1', jasmine.any(Object));
    expect(cmp.showEditModal).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.load).toHaveBeenCalled();
  });

  it('submitEdit n’appelle pas le service si le formulaire est invalide', () => {
    cmp.openEdit(ssdgps({ nature_ssdgps: '' }) as any, new Event('c'));
    cmp.submitEdit();
    expect(service.updateSsdgps).not.toHaveBeenCalled();
  });

  it('openDeleteModal (unitaire) puis confirmDelete supprime', () => {
    service.deleteSsdgps.and.returnValue(of(null));
    cmp.openDeleteModal(ssdgps() as any, new Event('c'));
    expect(cmp.isBulkDelete).toBeFalse();
    cmp.confirmDelete();
    expect(service.deleteSsdgps).toHaveBeenCalledWith('s1');
    expect(cmp.showDeleteModal).toBeFalse();
    expect(cmp.load).toHaveBeenCalled();
  });

  it('openBulkDelete refuse sans sélection', () => {
    cmp.selectedIds.clear();
    cmp.openBulkDelete();
    expect(cmp.showDeleteModal).toBeFalse();
  });

  it('confirmDelete (masse) supprime chaque élément sélectionné', () => {
    service.deleteSsdgps.and.returnValue(of(null));
    (cmp as any).activeItems = [ssdgps({ id: 'a' }), ssdgps({ id: 'b' })];
    cmp.selectedIds.add('a');
    cmp.selectedIds.add('b');
    cmp.openBulkDelete();
    expect(cmp.isBulkDelete).toBeTrue();
    cmp.confirmDelete();
    expect(service.deleteSsdgps).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalled();
  });

  it('confirmDelete gère l’échec par un toast d’erreur', () => {
    service.deleteSsdgps.and.returnValue(throwError(() => new Error('boom')));
    cmp.openDeleteModal(ssdgps() as any, new Event('c'));
    cmp.confirmDelete();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.deleting).toBeFalse();
  });
});

describe('ProjectSsdgpsListComponent (suppression définitive)', () => {
  let cmp: ProjectSsdgpsListComponent;
  let service: jasmine.SpyObj<any>;
  let toast: jasmine.SpyObj<any>;

  beforeEach(() => {
    service = jasmine.createSpyObj('ProjectsService', ['permanentDeleteSsdgps', 'bulkPermanentDeleteSsdgps']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    cmp = new ProjectSsdgpsListComponent(
      service, toast, {} as any, {} as any, {} as any, {} as any, new FormBuilder(),
      { get: () => of([]), save: () => of([]), resetToSource: () => of([]) } as any);
    spyOn(cmp, 'load');
    cmp.showDeleted = true;
  });

  const del = (over: any = {}) => ({ id: 's1', numero_ssdgps: 3, nature_ssdgps: 'rattachement', is_deleted: true, ...over });

  it('openBulkPermanentDelete refuse sans sélection', () => {
    cmp.selectedIds.clear();
    cmp.openBulkPermanentDelete();
    expect(cmp.showPermanentDeleteModal).toBeFalse();
  });

  it('confirmPermanentDelete (unitaire) appelle le service', () => {
    service.permanentDeleteSsdgps.and.returnValue(of(null));
    cmp.openPermanentDeleteModal(del() as any, new Event('c'));
    cmp.confirmPermanentDelete();
    expect(service.permanentDeleteSsdgps).toHaveBeenCalledWith('s1');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.load).toHaveBeenCalled();
  });

  it('confirmPermanentDelete (unitaire) affiche le message de blocage backend', () => {
    service.permanentDeleteSsdgps.and.returnValue(throwError(() => ({ error: { detail: 'Sous-données rattachées' } })));
    cmp.openPermanentDeleteModal(del() as any, new Event('c'));
    cmp.confirmPermanentDelete();
    expect(toast.error).toHaveBeenCalledWith('Suppression impossible', 'Sous-données rattachées');
    expect(cmp.permanentDeleting).toBeFalse();
  });

  it('confirmPermanentDelete (masse) : partiel → toast warning', () => {
    service.bulkPermanentDeleteSsdgps.and.returnValue(of({ deleted_count: 1, errors: [{ id: 'b' }] }));
    (cmp as any).deletedItems = [del({ id: 'a' }), del({ id: 'b' })];
    cmp.selectedIds.add('a');
    cmp.selectedIds.add('b');
    cmp.openBulkPermanentDelete();
    cmp.confirmPermanentDelete();
    expect(service.bulkPermanentDeleteSsdgps).toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });
});

describe('ProjectSsdgpsListComponent (config colonnes)', () => {
  let cmp: ProjectSsdgpsListComponent;
  let toast: any;
  let columnsSvc: any;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    columnsSvc = {
      get: jasmine.createSpy('get').and.returnValue(of([])),
      save: jasmine.createSpy('save').and.returnValue(of([])),
      resetToSource: jasmine.createSpy('resetToSource').and.returnValue(of([])),
    };
    cmp = new ProjectSsdgpsListComponent(
      {} as any, toast, {} as any, {} as any, {} as any, {} as any, new FormBuilder(), columnsSvc);
  });

  it('onColumnsChange applique les colonnes et programme l’enregistrement (clé « ssdgps »)', (done) => {
    const cols = [{ field: 'numero_ssdgps', label: 'SSDGPS', visible: false }] as any;
    cmp.onColumnsChange(cols);
    expect(cmp.columns).toBe(cols);
    setTimeout(() => {
      expect(columnsSvc.save).toHaveBeenCalledWith('ssdgps', [{ field: 'numero_ssdgps', visible: false }]);
      done();
    }, 600);
  });

  it('onResetColumns appelle le service pour la clé « ssdgps »', () => {
    columnsSvc.resetToSource.and.returnValue(of([{ field: 'nature_ssdgps', visible: true }]));
    cmp.onResetColumns();
    expect(columnsSvc.resetToSource).toHaveBeenCalledWith('ssdgps');
    expect(cmp.columns[0].field).toBe('nature_ssdgps');
    expect(toast.success).toHaveBeenCalled();
  });

  it('openColumnConfigFromContext ferme le menu contextuel et ouvre la modale de colonnes', () => {
    const open = jasmine.createSpy('open');
    (cmp as any).columnCfg = { open };
    cmp.showColumnContextMenu = true;
    cmp.openColumnConfigFromContext();
    expect(cmp.showColumnContextMenu).toBeFalse();
    expect(open).toHaveBeenCalled();
  });
});
