import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { initSentry } from './app/core/observability/sentry';


/**
 * @description Point d'entrée principal de l'application Angular.
 *              Bootstrap le module AppModule pour démarrer l'application.
 *
 *              L'observabilité est initialisée AVANT le bootstrap, pour que les erreurs
 *              survenues pendant le démarrage soient elles aussi capturées. Inerte tant
 *              qu'aucun DSN n'est configuré (cf. `core/observability/sentry.ts`).
 */
initSentry();

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
