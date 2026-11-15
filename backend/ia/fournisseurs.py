"""
Catalogue des fournisseurs d'IA utilisables par l'application.

`IA_FOURNISSEUR=<clé>` choisit un fournisseur : son protocole, son adresse et un
modèle suggéré sont pris ici ; `IA_BASE_URL`, `IA_MODELE`, `IA_PROTOCOLE` les
surchargent au besoin. La clé du fournisseur va dans `IA_CLE` (ou, par
compatibilité, `ANTHROPIC_API_KEY`).

Deux protocoles :
- `anthropic` : API Messages d'Anthropic (SDK officiel) — Anthropic, OmniRoute…
- `openai`    : « Chat Completions » compatible OpenAI — le protocole commun de la
  plupart des fournisseurs, dont ceux qui proposent des modèles GRATUITS.

Les noms de modèles évoluent vite : `modele` n'est qu'une suggestion. La commande
`python manage.py ia_verifier` liste les modèles réellement accessibles avec la clé.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Fournisseur:
    cle: str
    libelle: str
    protocole: str            # 'anthropic' | 'openai'
    base_url: str             # vide = adresse par défaut du SDK (Anthropic)
    modele: str = ''          # suggestion ; à confirmer avec ia_verifier
    gratuit: str = ''         # offre gratuite, en une phrase
    obtenir_cle: str = ''     # où créer la clé


FOURNISSEURS = {f.cle: f for f in (
    Fournisseur('anthropic', 'Anthropic (Claude)', 'anthropic', '', 'claude-opus-5-5',
                obtenir_cle='https://console.anthropic.com'),
    Fournisseur('google', 'Google Gemini (AI Studio)', 'openai',
                'https://generativelanguage.googleapis.com/v1beta/openai',
                gratuit="Clé gratuite AI Studio, quotas journaliers par modèle.",
                obtenir_cle='https://aistudio.google.com/apikey'),
    Fournisseur('openrouter', 'OpenRouter', 'openai', 'https://openrouter.ai/api/v1',
                gratuit='Nombreux modèles gratuits (suffixe « :free »), quotas réduits.',
                obtenir_cle='https://openrouter.ai/keys'),
    Fournisseur('groq', 'Groq', 'openai', 'https://api.groq.com/openai/v1',
                gratuit='Offre gratuite avec limites de débit.',
                obtenir_cle='https://console.groq.com/keys'),
    Fournisseur('mistral', 'Mistral AI', 'openai', 'https://api.mistral.ai/v1',
                gratuit="Offre d'essai gratuite (« Experiment ») avec limites de débit.",
                obtenir_cle='https://console.mistral.ai/api-keys'),
    Fournisseur('cerebras', 'Cerebras', 'openai', 'https://api.cerebras.ai/v1',
                gratuit='Offre gratuite avec limites de débit.',
                obtenir_cle='https://cloud.cerebras.ai'),
    Fournisseur('opencode', 'OpenCode', 'openai', 'https://opencode.ai/inference/openai/v1',
                gratuit="Les modèles gratuits d'OpenCode sont réservés à OpenCode : "
                        "seuls ses modèles payants servent ici.",
                obtenir_cle='https://opencode.ai'),
    Fournisseur('omniroute', 'OmniRoute (passerelle)', 'anthropic', 'http://localhost:20128',
                'Free-Combo',
                gratuit='Combine les offres gratuites de plusieurs fournisseurs.',
                obtenir_cle='Tableau de bord OmniRoute'),
)}


def fournisseur(cle: str):
    """Le fournisseur nommé, ou None (clé vide ou inconnue)."""
    return FOURNISSEURS.get((cle or '').strip().lower())
