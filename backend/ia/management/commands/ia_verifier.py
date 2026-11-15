"""
Diagnostic de la configuration de l'IA — `python manage.py ia_verifier`.

Affiche le fournisseur, le protocole, l'adresse et le(s) modèle(s) configurés, liste les
modèles que la clé donne le droit d'utiliser, puis fait un appel d'essai minuscule sur
chaque modèle (principal puis secours). La clé n'est JAMAIS affichée.

    python manage.py ia_verifier                  # tout
    python manage.py ia_verifier --sans-appel     # sans appel d'essai (rien de facturé)
    python manage.py ia_verifier --filtre :free   # ne lister que les modèles contenant « :free »
    python manage.py ia_verifier --fournisseurs   # catalogue des fournisseurs connus
"""
import time

from django.conf import settings
from django.core.management.base import BaseCommand

from ia import client, fournisseurs, openai_compat


class Command(BaseCommand):
    help = "Vérifie la configuration de l'IA (fournisseur, clé, modèles disponibles)."

    def add_arguments(self, parser):
        parser.add_argument('--sans-appel', action='store_true',
                            help="Ne pas faire d'appel d'essai.")
        parser.add_argument('--filtre', default='',
                            help='Ne lister que les modèles dont le nom contient ce texte.')
        parser.add_argument('--fournisseurs', action='store_true',
                            help='Afficher le catalogue des fournisseurs et quitter.')

    def handle(self, *args, sans_appel=False, filtre='', fournisseurs=False, **options):
        if fournisseurs:
            return self._catalogue()
        ok, ko, info = self.style.SUCCESS, self.style.ERROR, self.style.WARNING
        f = client.fournisseur()
        self.stdout.write("Configuration de l'IA")
        self.stdout.write(f"  IA_ACTIVE      : {getattr(settings, 'IA_ACTIVE', False)}")
        self.stdout.write(f"  Fournisseur    : {f.libelle if f else '— (API Anthropic / adresse libre)'}")
        self.stdout.write(f"  Protocole      : {client.protocole()}")
        self.stdout.write(f"  Service        : {client.adresse() or 'API Anthropic directe'}")
        self.stdout.write(f"  Mode compatible: {client.compatible()}")
        self.stdout.write(f"  Modèle(s)      : {' → '.join(client.modeles_essai())}")
        self.stdout.write(f"  Clé            : {'présente' if client.cle() else 'ABSENTE'}")
        if f and f.gratuit:
            self.stdout.write(f"  Offre gratuite : {f.gratuit}")
        if not client.cle():
            self.stdout.write(ko("Aucune clé : renseignez IA_CLE dans le .env (ou les variables "
                                 "du serveur)" + (f" — clé à créer sur {f.obtenir_cle}" if f else '') + '.'))
            return
        if not client.disponible():
            self.stdout.write(info("IA_ACTIVE est faux : l'application n'utilisera pas l'IA "
                                   "(le diagnostic continue)."))

        ids = self._modeles()
        if ids is None:
            return
        if ids:
            visibles = [i for i in ids if filtre.lower() in i.lower()] if filtre else ids
            self.stdout.write(f"\n{len(ids)} modèle(s) accessible(s)"
                              + (f", {len(visibles)} avec « {filtre} »" if filtre else '') + ' :')
            essais = set(client.modeles_essai())
            for i in visibles[:200]:
                marque = '  ← configuré' if i in essais else ''
                self.stdout.write(f'  - {i}{marque}')
            absents = [m for m in client.modeles_essai() if m not in ids]
            if absents:
                self.stdout.write(info(f"\nAbsent(s) de la liste : {', '.join(absents)} — "
                                       "vérifiez le nom (certains fournisseurs ne listent pas tout)."))
        if not sans_appel:
            for m in client.modeles_essai():
                self._essai(m)

    def _catalogue(self):
        for f in fournisseurs.FOURNISSEURS.values():
            self.stdout.write(f"{f.cle:<11} {f.libelle} — protocole {f.protocole}")
            if f.gratuit:
                self.stdout.write(f"            gratuit : {f.gratuit}")
            if f.obtenir_cle:
                self.stdout.write(f"            clé     : {f.obtenir_cle}")

    def _modeles(self):
        """Identifiants accessibles ; None = arrêt (clé refusée, service injoignable)."""
        ko, info = self.style.ERROR, self.style.WARNING
        if client.protocole() == 'openai':
            try:
                return openai_compat.lister_modeles(client.adresse(), client.cle())
            except openai_compat.ErreurConnexion:
                self.stdout.write(ko(f'Service injoignable : {client.adresse()}'))
                return None
            except openai_compat.ErreurHttp as exc:
                if exc.statut in (401, 403):
                    self.stdout.write(ko(f'Clé refusée par le service ({exc.statut}).'))
                    return None
                self.stdout.write(info(f'Liste des modèles indisponible ({exc.statut}).'))
                return []
        import anthropic
        client.reinitialiser_client()
        try:
            # PREMIÈRE page seulement (`.data`) : itérer la page enchaîne les requêtes, et une
            # passerelle qui ne renvoie pas `has_more` fait alors boucler le SDK sans fin.
            page = client._client().models.list(limit=1000)
            return [m.id for m in (getattr(page, 'data', None) or page)]
        except anthropic.AuthenticationError:
            self.stdout.write(ko('Clé refusée par le service (401).'))
        except anthropic.APIConnectionError:
            self.stdout.write(ko(f"Service injoignable : {client.adresse() or 'api.anthropic.com'}"))
        except anthropic.APIStatusError as exc:
            self.stdout.write(info(f'Liste des modèles indisponible ({exc.status_code}).'))
            return []
        return None

    def _essai(self, nom_modele):
        ok, ko = self.style.SUCCESS, self.style.ERROR
        message = [{'role': 'user', 'content': 'Réponds uniquement par : OK'}]
        debut = time.monotonic()
        try:
            if client.protocole() == 'openai':
                r = openai_compat.creer(client.adresse(), client.cle(), modele=nom_modele,
                                        messages=message, max_tokens=400)
            else:
                r = client._client().messages.create(model=nom_modele, max_tokens=400,
                                                     messages=message)
        except Exception as exc:  # noqa: BLE001 - un diagnostic rapporte, il ne plante pas
            statut = getattr(exc, 'statut', None) or getattr(exc, 'status_code', None)
            self.stdout.write(ko(f"Essai « {nom_modele} » : échec"
                                 + (f' ({statut})' if statut else '') + f' — {str(exc)[:160]}'))
            return
        self.stdout.write(ok(f"Essai « {nom_modele} » réussi en {time.monotonic() - debut:.1f} s "
                             f"(servi par « {r.model} ») : {client.texte(r)[:60]!r}"))
