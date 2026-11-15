import { fakeAsync, tick } from '@angular/core/testing';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AuditJournalComponent, familleAction, jourIso } from './audit-journal.component';

const EV: any = { id: 'e1', created_at: '2026-11-15T10:00:00Z', action: 'LOGIN_FAILED', action_display: 'Échec de connexion',
                  acteur: null, acteur_email: 'x@y.ma', acteur_nom: 'x@y.ma', cible_type: '', cible_id: '',
                  cible_libelle: '', adresse_ip: '1.2.3.4', details: { motif: 'mot de passe', compte: { id: 3 }, vide: '' } };

describe('AuditJournalComponent', () => {
  let audit: any;
  let cmp: AuditJournalComponent;

  beforeEach(() => {
    audit = {
      evenements: jasmine.createSpy('evenements').and.returnValue(of({ count: 120, next: 'x', previous: null, results: [EV] })),
      synthese: jasmine.createSpy('synthese').and.returnValue(of({ total: 120, par_action: [], acteurs_distincts: 4,
                                                                 echecs_connexion: 2, premier: null, dernier: null })),
      options: jasmine.createSpy('options').and.returnValue(of({ actions: [{ value: 'LOGIN_OK', label: 'Connexion réussie' }],
                                                               types_cible: ['ssdgps'] })),
      exporter: jasmine.createSpy('exporter').and.returnValue(of(new HttpResponse({
        body: new Blob(['a;b']), headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="journal-audit-x.csv"' }) }))),
    };
    cmp = new AuditJournalComponent(audit);
    cmp.ngOnInit();
  });

  afterEach(() => cmp.ngOnDestroy());

  it('charge les 7 derniers jours, la synthèse et les options', () => {
    const [filtres, page, taille] = audit.evenements.calls.mostRecent().args;
    expect(filtres.depuis).toBeTruthy();
    expect(filtres.jusqu_a).toBe(jourIso(new Date()));
    expect([page, taille]).toEqual([1, 50]);
    expect(cmp.total).toBe(120);
    expect(cmp.nbPages).toBe(3);
    expect(cmp.synthese?.echecs_connexion).toBe(2);
    expect(cmp.options.types_cible).toEqual(['ssdgps']);
  });

  it('la recherche est différée, et revient en première page', fakeAsync(() => {
    cmp.allerPage(3);
    audit.evenements.calls.reset();
    cmp.filtres.q = 'zay';
    cmp.onRecherche();
    cmp.onRecherche();
    tick(350);
    expect(audit.evenements).toHaveBeenCalledTimes(1);
    expect(cmp.page).toBe(1);
  }));

  it('périodes rapides et « tout »', () => {
    cmp.choisirPeriode('jour');
    expect(cmp.filtres.depuis).toBe(jourIso(new Date()));
    cmp.choisirPeriode('tout');
    expect(cmp.filtres.depuis).toBeUndefined();
    expect(cmp.filtres.jusqu_a).toBeUndefined();
  });

  it('une puce d’action filtre puis défiltre', () => {
    cmp.filtrerAction('LOGIN_FAILED');
    expect(cmp.filtres.action).toBe('LOGIN_FAILED');
    cmp.filtrerAction('LOGIN_FAILED');
    expect(cmp.filtres.action).toBeUndefined();
  });

  it('pagination bornée, taille de page, ordre', () => {
    cmp.allerPage(99);
    expect(cmp.page).toBe(3);
    cmp.changerTaille(200);
    expect([cmp.page, cmp.taille]).toEqual([1, 200]);
    cmp.basculerOrdre();
    expect(audit.evenements.calls.mostRecent().args[0].ordre).toBe('asc');
  });

  it('détails lisibles, valeurs vides écartées', () => {
    expect(cmp.details(EV)).toEqual([{ cle: 'motif', valeur: 'mot de passe' }, { cle: 'compte', valeur: '{"id":3}' }]);
    cmp.basculerDetail(EV);
    expect(cmp.ouvert).toBe('e1');
    cmp.basculerDetail(EV);
    expect(cmp.ouvert).toBeNull();
  });

  it('export : télécharge le fichier nommé par le serveur', () => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    cmp.exporter();
    expect(audit.exporter).toHaveBeenCalled();
    expect(cmp.export).toBeFalse();
  });

  it('erreur 403 : message explicite', () => {
    audit.evenements.and.returnValue(throwError(() => ({ status: 403 })));
    cmp.charger();
    expect(cmp.erreur).toContain('réservé');
  });

  it('réinitialiser revient aux 7 derniers jours', () => {
    cmp.filtres.q = 'x';
    cmp.choisirPeriode('tout');
    cmp.reinitialiser();
    expect(cmp.filtres.q).toBeUndefined();
    expect(cmp.periode).toBe('7j');
  });

  it('familles d’actions', () => {
    expect(familleAction('LOGIN_FAILED')).toBe('alerte');
    expect(familleAction('AI_CALL')).toBe('ia');
    expect(familleAction('INCONNUE')).toBe('autre');
  });
});
