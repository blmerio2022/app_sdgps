"""backend URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve as static_serve

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/v1/platform-admin/', include('platform_admin.urls')),
    path('api/v1/organizations/', include('organizations.urls')),  # ← AJOUT: Gestion organisations
    path('api/v1/', include('organismes.urls')),  # ← AJOUT: Organismes premier/deuxième niveau
    path('api/v1/users/', include('accounts.users_urls')),  # ← AJOUT: Gestion utilisateurs
    path('api/v1/', include('projects.urls')),  # ← AJOUT: Domaine métier (projets, propriétés, affaires, ssdgps, sessions)
    path('api/v1/', include('pieces.urls')),  # ← AJOUT: Pièces SSDGPS/Session (Phase 6.5)
    path('api/v1/analytics/', include('analytics.urls')),  # ← AJOUT: Analytique de stockage (admin)
]

# Fichiers médias (uploads). En DEBUG, Django les sert nativement. En production (DEBUG=False),
# on les sert explicitement depuis MEDIA_ROOT (volume persistant Railway) — sinon ils ne sont
# plus accessibles. Pour un stockage S3/R2, ce sont des URLs externes → ce handler est inerte.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', static_serve, {'document_root': settings.MEDIA_ROOT}),
    ]

# Catch-all SPA : toute route NON servie ci-dessus (ni /api, /admin, /media, ni un fichier
# statique servi par WhiteNoise) renvoie l'index.html BRUT du build Angular (pas de passage par
# le moteur de templates Django), pour laisser le routeur Angular gérer la navigation côté
# client. Actif uniquement si le build est embarqué dans l'image.
if getattr(settings, 'FRONTEND_DIST_DIR', None) and settings.FRONTEND_DIST_DIR.exists():
    def _spa_index(request, *args, **kwargs):
        return static_serve(request, 'index.html', document_root=settings.FRONTEND_DIST_DIR)

    urlpatterns += [re_path(r'^(?!api/|admin/|media/|static/).*$', _spa_index)]
else:
    # Backend LOCAL servi seul (le frontend tourne sur un serveur séparé, ex. ng serve).
    # La racine `/` n'a alors aucune page → on expose un mini health-check plutôt qu'un 404
    # déroutant. N'existe PAS quand le SPA est embarqué (prod Railway) : la racine y sert l'app.
    from django.http import JsonResponse

    def api_health(request):
        return JsonResponse({
            'service': 'SDGPS API',
            'status': 'ok',
            'message': 'API SDGPS OK',
            'environment': settings.ENVIRONMENT,
            'api': '/api/',
        })

    urlpatterns += [path('', api_health, name='api-health')]
