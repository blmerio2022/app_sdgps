import * as Sentry from '@sentry/angular-ivy';

import { environment } from '../../../environments/environment';

/**
 * Observabilité du frontend (Sentry).
 *
 * Sans télémétrie, une erreur côté navigateur n'existe que dans la console de
 * l'opérateur : personne ne la voit, et elle n'est reproductible que si l'utilisateur
 * pense à la raconter.
 *
 * Entièrement INERTE tant que `environment.sentryDsn` est vide : aucune initialisation,
 * aucun appel réseau. C'est l'état par défaut dans le dépôt.
 *
 * Données personnelles : `sendDefaultPii` reste à `false`. L'application manipule des
 * données foncières nominatives ; ni le corps des requêtes, ni les cookies, ni l'adresse
 * IP ne partent chez un tiers.
 */

/** Vrai si l'environnement courant active la télémétrie. */
export function sentryEstActif(env: { sentryDsn?: string } = environment): boolean {
  return !!(env.sentryDsn && env.sentryDsn.trim());
}

/**
 * Initialise Sentry si un DSN est configuré.
 *
 * `init` est injectable : un export de module ES n'est pas remplaçable par un espion,
 * et c'est précisément l'appel qu'il faut pouvoir vérifier — notamment pour prouver
 * qu'il N'A PAS lieu sans DSN.
 *
 * @returns `true` si la télémétrie a été activée, `false` sinon.
 */
export function initSentry(
  env: { sentryDsn?: string; production?: boolean } = environment,
  init: (options: Sentry.BrowserOptions) => void = Sentry.init,
): boolean {
  if (!sentryEstActif(env)) {
    return false;
  }

  init({
    dsn: (env.sentryDsn as string).trim(),
    environment: env.production ? 'production' : 'development',
    sendDefaultPii: false,
    // Pas d'échantillonnage de performance par défaut : on cherche les erreurs, pas des
    // métriques de latence, et chaque trace est facturée.
    tracesSampleRate: 0,
  });
  return true;
}
