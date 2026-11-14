import { AppComponent } from './app.component';

describe('AppComponent', () => {
  const versions = jasmine.createSpyObj('VersionService', ['demarrer']);

  it('expose le titre de l’application', () => {
    const cmp = new AppComponent(versions);
    expect(cmp.title).toContain('SDGPS');
  });

  it('lance le suivi de la version déployée dès le démarrage', () => {
    new AppComponent(versions);
    expect(versions.demarrer).toHaveBeenCalled();
  });
});
