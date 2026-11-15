"""
Diagnostic de la configuration de l'IA — `python manage.py ia_verifier`.

Affiche le mode (API Anthropic directe ou passerelle type OmniRoute), l'adresse et le
modèle configurés, liste les modèles que la clé donne le droit d'utiliser, puis fait un
appel d'essai minuscule. La clé n'est JAMAIS affichée.

    python manage.py ia_verifier                 # tout
    python manage.py ia_verifier --sans-appel    # sans l'appel d'essai (rien de facturé)
    python manage.py ia_verifier --filtre claude # ne lister que les modèles contenant « claude »
"""
import time

from django.conf import settings
from django.core.management.base import BaseCommand

from ia import client


class Command(BaseCommand):
    help = "Vérifie la configuration de l'IA (passerelle, clé, modèles disponibles)."

    def add_arguments(self, parser):
        parser.add_argument('--sans-appel', action='store_true',
                            help="Ne pas faire l'appel d'essai.")
        parser.add_argument('--filtre', default='',
                            help='Ne lister que les modèles dont le nom contient ce texte.')

    def handle(self, *args, sans_appel=False, filtre='', **options):
        ok, ko, info = self.style.SUCCESS, self.style.ERROR, self.style.WARNING
        cle = bool(getattr(settings, 'ANTHROPIC_API_KEY', ''))
        self.stdout.write("Configuration de l'IA")
        self.stdout.write(f"  IA_ACTIVE      : {getattr(settings, 'IA_ACTIVE', False)}")
        self.stdout.write(f"  Clé (ANTHROPIC_API_KEY) : {'présente' if cle else 'ABSENTE'}")
        self.stdout.write(f"  Service        : {client.adresse() or 'API Anthropic directe'}")
        self.stdout.write(f"  Mode compatible: {client.compatible()}")
        self.stdout.write(f"  Modèle         : {client.modele()}")
        if not cle:
            self.stdout.write(ko("Aucune clé : renseignez ANTHROPIC_API_KEY dans le .env."))
            return
        if not client.disponible():
            self.stdout.write(info("IA_ACTIVE est faux : l'application n'utilisera pas l'IA "
                                   "(le diagnostic continue)."))

        import anthropic
        client.reinitialiser_client()
        sdk = client._client()

        # 1) Modèles accessibles avec cette clé.
        try:
            ids = [m.id for m in sdk.models.list(limit=1000)]
        except anthropic.AuthenticationError:
            self.stdout.write(ko('Clé refusée par le service (401).'))
            return
        except anthropic.APIConnectionError:
            self.stdout.write(ko(f"Service injoignable : {client.adresse() or 'api.anthropic.com'}"))
            return
        except anthropic.APIStatusError as exc:
            self.stdout.write(info(f'Liste des modèles indisponible ({exc.status_code}).'))
            ids = []
        if ids:
            visibles = [i for i in ids if filtre.lower() in i.lower()] if filtre else ids
            self.stdout.write(f"\n{len(ids)} modèle(s) accessible(s)"
                              + (f", {len(visibles)} avec « {filtre} »" if filtre else '') + ' :')
            for i in visibles[:200]:
                marque = '  ← IA_MODELE' if i == client.modele() else ''
                self.stdout.write(f'  - {i}{marque}')
            if client.modele() not in ids:
                self.stdout.write(ko(f"\nIA_MODELE « {client.modele()} » n'est pas dans la liste : "
                                     "choisissez-en un ci-dessus."))

        # 2) Appel d'essai.
        if sans_appel:
            return
        debut = time.monotonic()
        try:
            r = sdk.messages.create(model=client.modele(), max_tokens=64,
                                    messages=[{'role': 'user',
                                               'content': 'Réponds uniquement par : OK'}])
        except anthropic.APIStatusError as exc:
            self.stdout.write(ko(f"\nAppel d'essai en échec ({exc.status_code}) : {exc.message}"))
            return
        except anthropic.APIConnectionError:
            self.stdout.write(ko("\nAppel d'essai : service injoignable."))
            return
        duree = time.monotonic() - debut
        self.stdout.write(ok(f"\nAppel d'essai réussi en {duree:.1f} s — modèle « {r.model} » : "
                             f"{client.texte(r)[:80]!r}"))
