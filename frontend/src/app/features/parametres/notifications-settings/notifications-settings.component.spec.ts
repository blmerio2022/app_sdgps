import { of, throwError } from 'rxjs';
import { NotificationsSettingsComponent } from './notifications-settings.component';

const PREFS: any = { emails_actifs: true, types: [{ type: 'RAPPORT_PRET', libelle: 'Rapport prêt', email: false, defaut: false }] };

describe('NotificationsSettingsComponent', () => {
  let svc: any;
  let cmp: NotificationsSettingsComponent;

  beforeEach(() => {
    svc = {
      preferences: jasmine.createSpy('preferences').and.returnValue(of(PREFS)),
      enregistrerPreferences: jasmine.createSpy('enregistrer').and.returnValue(of({ ...PREFS, emails_actifs: false })),
    };
    cmp = new NotificationsSettingsComponent(svc);
    cmp.ngOnInit();
  });

  it('charge les préférences', () => {
    expect(cmp.prefs?.types.length).toBe(1);
    expect(cmp.chargement).toBeFalse();
  });

  it('enregistre immédiatement chaque bascule', () => {
    cmp.basculerType('RAPPORT_PRET', true);
    expect(svc.enregistrerPreferences).toHaveBeenCalledWith({ types: { RAPPORT_PRET: true } });
    cmp.basculerGlobal(false);
    expect(svc.enregistrerPreferences).toHaveBeenCalledWith({ emails_actifs: false });
    expect(cmp.prefs?.emails_actifs).toBeFalse();
  });

  it('erreur d’enregistrement affichée', () => {
    svc.enregistrerPreferences.and.returnValue(throwError(() => ({ error: { detail: 'Type inconnu' } })));
    cmp.basculerType('X', true);
    expect(cmp.erreur).toBe('Type inconnu');
  });
});
