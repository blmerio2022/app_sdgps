import { of, throwError } from 'rxjs';
import { StorageQuotasComponent } from './storage-quotas.component';
import { OrganizationQuota } from '../../../core/services/storage-quota.service';

describe('StorageQuotasComponent', () => {
  let cmp: StorageQuotasComponent;
  let service: jasmine.SpyObj<{ list: any; setQuota: any }>;
  let toast: jasmine.SpyObj<{ success: any; error: any }>;

  function quota(over: Partial<OrganizationQuota> = {}): OrganizationQuota {
    return {
      organization_id: 'org-1', organization_name: 'Org 1',
      quota_bytes: 1024 ** 3, effective_quota_bytes: 1024 ** 3,
      used_bytes: 512 * 1024 ** 2, remaining_bytes: 512 * 1024 ** 2,
      usage_percent: 50, is_unlimited: false, is_exceeded: false, ...over,
    };
  }

  beforeEach(() => {
    service = jasmine.createSpyObj('StorageQuotaService', ['list', 'setQuota']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    service.list.and.returnValue(of({ default_quota_bytes: 0, results: [quota()] }));
    cmp = new StorageQuotasComponent(service as any, toast as any);
  });

  it('charge les quotas et pré-remplit la saisie en Go', () => {
    cmp.ngOnInit();
    expect(cmp.quotas.length).toBe(1);
    expect(cmp.draft['org-1']).toBe(1);          // 1 Gio → 1 Go dans le champ
    expect(cmp.loading).toBeFalse();
  });

  it('affiche un message clair quand l’accès est refusé', () => {
    service.list.and.returnValue(throwError(() => ({
      status: 403, error: { detail: 'Seul le super administrateur peut consulter les quotas.' },
    })));
    cmp.ngOnInit();
    expect(cmp.error).toContain('super administrateur');
    expect(cmp.loading).toBeFalse();
  });

  it('enregistre le plafond converti en octets', () => {
    cmp.ngOnInit();
    service.setQuota.and.returnValue(of(quota({ quota_bytes: 2 * 1024 ** 3 })));
    cmp.draft['org-1'] = 2;
    cmp.save(cmp.quotas[0]);

    expect(service.setQuota).toHaveBeenCalledWith('org-1', 2 * 1024 ** 3);
    expect(toast.success).toHaveBeenCalled();
  });

  it('un champ vide renvoie null (retour au défaut global)', () => {
    cmp.ngOnInit();
    service.setQuota.and.returnValue(of(quota({ quota_bytes: null })));
    cmp.draft['org-1'] = null;
    cmp.save(cmp.quotas[0]);
    expect(service.setQuota).toHaveBeenCalledWith('org-1', null);
  });

  it('resetToDefault remet l’organisation au défaut global', () => {
    cmp.ngOnInit();
    service.setQuota.and.returnValue(of(quota({ quota_bytes: null })));
    cmp.resetToDefault(cmp.quotas[0]);
    expect(service.setQuota).toHaveBeenCalledWith('org-1', null);
  });

  it('signale un échec d’enregistrement sans bloquer la ligne', () => {
    cmp.ngOnInit();
    service.setQuota.and.returnValue(throwError(() => ({ error: { detail: 'Refusé' } })));
    cmp.save(cmp.quotas[0]);
    expect(toast.error).toHaveBeenCalledWith('Quota', 'Refusé');
    expect(cmp.saving['org-1']).toBeFalse();     // la ligne redevient modifiable
  });

  it('ignore un second envoi tant que le premier est en cours', () => {
    cmp.ngOnInit();
    cmp.saving['org-1'] = true;
    cmp.save(cmp.quotas[0]);
    expect(service.setQuota).not.toHaveBeenCalled();
  });

  describe('restitution de l’usage', () => {
    it('barre bornée à 100 % même en dépassement', () => {
      expect(cmp.usageWidth(quota({ usage_percent: 180 }))).toBe(100);
    });

    it('aucune barre pour un quota illimité', () => {
      expect(cmp.usageWidth(quota({ is_unlimited: true, usage_percent: null }))).toBe(0);
      expect(cmp.quotaLabel(quota({ is_unlimited: true }))).toBe('Illimité');
    });

    it('couleur selon le palier', () => {
      expect(cmp.usageClass(quota({ usage_percent: 10 }))).toBe('is-ok');
      expect(cmp.usageClass(quota({ usage_percent: 80 }))).toBe('is-warning');
      expect(cmp.usageClass(quota({ is_exceeded: true }))).toBe('is-exceeded');
      expect(cmp.usageClass(quota({ is_unlimited: true }))).toBe('is-unlimited');
    });
  });
});
