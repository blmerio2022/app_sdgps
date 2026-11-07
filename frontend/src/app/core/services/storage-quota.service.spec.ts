import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import {
  StorageQuotaService, bytesToGibibytes, gibibytesToBytes, humanBytes,
} from './storage-quota.service';
import { environment } from '../../../environments/environment';

describe('StorageQuotaService', () => {
  let service: StorageQuotaService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/v1/organizations`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [StorageQuotaService],
    });
    service = TestBed.inject(StorageQuotaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() interroge l’endpoint des quotas', () => {
    let recu: any = null;
    service.list().subscribe(r => (recu = r));

    const req = http.expectOne(`${base}/storage-quotas/`);
    expect(req.request.method).toBe('GET');
    req.flush({ default_quota_bytes: 0, results: [] });
    expect(recu.results).toEqual([]);
  });

  it('setQuota() envoie un PUT avec la valeur en octets', () => {
    service.setQuota('org-1', 2048).subscribe();
    const req = http.expectOne(`${base}/org-1/storage-quota/`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ storage_quota_bytes: 2048 });
    req.flush({});
  });

  it('setQuota(null) demande le retour au défaut global', () => {
    service.setQuota('org-1', null).subscribe();
    const req = http.expectOne(`${base}/org-1/storage-quota/`);
    expect(req.request.body).toEqual({ storage_quota_bytes: null });
    req.flush({});
  });
});

describe('storage-quota : conversions', () => {
  it('humanBytes reproduit le format du serveur', () => {
    expect(humanBytes(0)).toBe('0 octets');
    expect(humanBytes(512)).toBe('512 octets');
    expect(humanBytes(1024)).toBe('1 Ko');
    expect(humanBytes(1536)).toBe('1,5 Ko');
    expect(humanBytes(5 * 1024 ** 3)).toBe('5 Go');
  });

  it('gibibytesToBytes convertit la saisie en octets', () => {
    expect(gibibytesToBytes(1)).toBe(1024 ** 3);
    expect(gibibytesToBytes(0)).toBe(0);           // 0 Go = illimité, pas « vide »
  });

  it('gibibytesToBytes préserve null (retour au défaut global)', () => {
    expect(gibibytesToBytes(null)).toBeNull();
  });

  it('gibibytesToBytes ne produit jamais de valeur négative', () => {
    expect(gibibytesToBytes(-3)).toBe(0);
  });

  it('bytesToGibibytes pré-remplit le champ de saisie', () => {
    expect(bytesToGibibytes(1024 ** 3)).toBe(1);
    expect(bytesToGibibytes(null)).toBeNull();     // non arbitré → champ vide
  });
});
