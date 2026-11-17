import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { StockageService, estRefusQuota, messageRefusQuota, octetsLisibles, refusQuota } from './stockage.service';

describe('StockageService', () => {
  let svc: StockageService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    svc = TestBed.inject(StockageService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lit l’espace de stockage de l’utilisateur connecté', () => {
    let lu: any;
    svc.monStockage().subscribe(d => lu = d);
    const req = http.expectOne(`${environment.apiUrl}/v1/analytics/mon-stockage/`);
    expect(req.request.method).toBe('GET');
    req.flush({ organisation: null, ma_part_bytes: 0, mes_projets: [] });
    expect(lu.organisation).toBeNull();
  });
});

describe('refus de quota', () => {
  const refus = { error: { code: 'QUOTA_DEPASSE', detail: 'Quota de stockage dépassé pour l’organisation « A »',
    quota: { organization_name: 'A', quota_bytes: 10, used_bytes: 9, remaining_bytes: 1, incoming_bytes: 5 } } };

  it('reconnu par son code', () => {
    expect(estRefusQuota(refus)).toBeTrue();
    expect(refusQuota(refus)?.incoming_bytes).toBe(5);
    expect(messageRefusQuota(refus)).toContain('« A »');
  });

  it('reconnu par son message quand seul le texte est transmis', () => {
    expect(estRefusQuota({ error: { detail: 'Quota de stockage dépassé : …' } })).toBeTrue();
    expect(refusQuota({ error: { detail: 'Quota de stockage dépassé : …' } })).toBeNull();
  });

  it('une autre erreur n’en est pas un', () => {
    expect(estRefusQuota({ error: { code: 'invalid', detail: 'Code invalide' } })).toBeFalse();
    expect(estRefusQuota({ error: { code: ['Ce code existe déjà'] } })).toBeFalse();
    expect(estRefusQuota(null)).toBeFalse();
    expect(messageRefusQuota({})).toContain('rien n\'a été enregistré');
  });

  it('tailles lisibles en unités françaises', () => {
    expect(octetsLisibles(512)).toBe('512 octets');
    expect(octetsLisibles(1536)).toBe('1,5 Ko');
    expect(octetsLisibles(10737418)).toBe('10,2 Mo');
    expect(octetsLisibles(null)).toBe('0 octets');
  });
});
