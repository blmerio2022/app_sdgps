"""
Garde-fou : aucune vue de l'API n'est publique par accident.

Le défaut DRF du projet est `IsAuthenticated` (cf. `settings.REST_FRAMEWORK`). Il l'a
longtemps été `AllowAny`, ce qui rendait publique, en silence, toute vue qui oubliait de
déclarer ses permissions. Le défaut fermé supprime la classe d'erreur ; ce test empêche
qu'elle revienne, par un retour en arrière sur le réglage comme par un `AllowAny` posé à
la légère sur une vue métier.

Le test parcourt l'URLconf réelle : il voit donc toute nouvelle route, sans qu'il faille
penser à l'y inscrire.
"""
from django.test import TestCase
from django.urls import get_resolver
from django.urls.resolvers import URLPattern, URLResolver
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.settings import api_settings

# Vues publiques ASSUMÉES, et la raison de chacune. Toute autre vue publique fait
# échouer le test : si l'ajout est volontaire, il faut l'inscrire ici — c'est-à-dire
# l'assumer explicitement.
VUES_PUBLIQUES_AUTORISEES = {
    'LoginView': "point d'entrée de l'authentification",
    'ForgotPasswordView': "demande de réinitialisation (utilisateur déconnecté)",
    'VerifyCodeView': "vérification du code reçu par email",
    'ResetPasswordView': "réinitialisation avec le jeton issu du code",
    'TokenRefreshView': "rafraîchissement JWT, validé par le jeton lui-même",
}


def _vues_de_l_urlconf(patterns=None, prefixe=''):
    """Itère sur (chemin, classe de vue DRF) pour toute l'URLconf du projet."""
    if patterns is None:
        patterns = get_resolver().url_patterns
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            yield from _vues_de_l_urlconf(pattern.url_patterns, prefixe + str(pattern.pattern))
        elif isinstance(pattern, URLPattern):
            cls = getattr(pattern.callback, 'cls', None)  # posé par APIView.as_view()
            if cls is not None:
                yield prefixe + str(pattern.pattern), cls


def _permissions_de(cls):
    """Classes de permission effectives d'une vue (défaut du projet si non déclarées)."""
    return getattr(cls, 'permission_classes', api_settings.DEFAULT_PERMISSION_CLASSES)


class DefautDePermissionTests(TestCase):
    def test_le_defaut_du_projet_est_ferme(self):
        self.assertEqual(list(api_settings.DEFAULT_PERMISSION_CLASSES), [IsAuthenticated])

    def test_l_urlconf_expose_bien_des_vues_drf(self):
        """Garde-fou du garde-fou : un parcours vide validerait tout."""
        vues = list(_vues_de_l_urlconf())

        self.assertGreater(len(vues), 30, "le parcours de l'URLconf n'a presque rien trouvé")

    def test_aucune_vue_publique_hors_authentification(self):
        publiques = set()
        for chemin, cls in _vues_de_l_urlconf():
            permissions = _permissions_de(cls)
            if not permissions or AllowAny in permissions:
                if cls.__name__ not in VUES_PUBLIQUES_AUTORISEES:
                    publiques.add(f'{cls.__name__} ({chemin})')

        self.assertEqual(
            publiques, set(),
            "Vue(s) accessibles sans authentification. Si c'est voulu, inscrivez-les "
            "dans VUES_PUBLIQUES_AUTORISEES avec leur justification ; sinon, posez "
            "`permission_classes = [IsAuthenticated]`.",
        )

    def test_les_vues_publiques_declarees_existent_toutes(self):
        """L'allowlist ne doit pas accumuler des entrées mortes."""
        noms = {cls.__name__ for _, cls in _vues_de_l_urlconf()}

        self.assertEqual(set(VUES_PUBLIQUES_AUTORISEES) - noms, set())

    def test_les_vues_publiques_posent_allowany_explicitement(self):
        """Une vue publique ne doit pas l'être « par défaut », mais par déclaration."""
        from accounts import views

        for nom in ('LoginView', 'ForgotPasswordView', 'VerifyCodeView', 'ResetPasswordView'):
            with self.subTest(vue=nom):
                self.assertIn(AllowAny, getattr(views, nom).permission_classes)

    def test_une_vue_metier_type_exige_l_authentification(self):
        from projects.views import ProjetViewSet

        self.assertNotIn(AllowAny, _permissions_de(ProjetViewSet))


class VueSansDeclarationTests(TestCase):
    """Une vue qui oublie ses permissions est fermée, pas ouverte."""

    def test_une_apiview_nue_herite_du_defaut_ferme(self):
        from rest_framework.views import APIView

        class VueOublieuse(APIView):
            pass

        self.assertEqual(
            [p.__name__ for p in _permissions_de(VueOublieuse)], ['IsAuthenticated'],
        )

    def test_un_appel_anonyme_sur_une_vue_metier_renvoie_401(self):
        from rest_framework.test import APIClient

        resp = APIClient().get('/api/v1/projets/')

        self.assertEqual(resp.status_code, 401)
