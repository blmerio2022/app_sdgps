"""
Middleware pour forcer le changement de mot de passe.
Redirige les utilisateurs qui doivent changer leur mot de passe.
"""
from django.shortcuts import redirect


class ForcePasswordChangeMiddleware:
    """
    Middleware qui vérifie si l'utilisateur doit changer son mot de passe.
    Si oui, redirige vers la page de changement obligatoire.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Vérifier si l'utilisateur est authentifié
        if request.user.is_authenticated:
            # Vérifier si l'utilisateur doit changer son mot de passe
            if hasattr(request.user, 'requires_password_change') and request.user.requires_password_change():
                # Liste des URLs autorisées même si MDP doit être changé
                allowed_paths = [
                    '/api/auth/change-password/',  # API changement MDP
                    '/api/auth/logout/',           # API logout
                    '/api/version/',               # Version déployée (publique)
                    '/static/',                     # Fichiers statiques
                    '/media/',                      # Fichiers media
                ]
                
                # Si l'URL actuelle n'est pas dans la liste autorisée
                if not any(request.path.startswith(path) for path in allowed_paths):
                    # Pour les requêtes API, retourner une erreur 403 au lieu de redirect
                    if request.path.startswith('/api/'):
                        from django.http import JsonResponse
                        return JsonResponse({
                            'detail': 'Vous devez changer votre mot de passe avant d\'accéder à l\'application.',
                            'code': 'MUST_CHANGE_PASSWORD',
                            'redirect_url': '/auth/change-password?reason=first_login'
                        }, status=403)
                    
                    # Rediriger vers la page de changement de mot de passe (Angular)
                    return redirect('/auth/change-password?reason=first_login')
        
        # Continuer normalement
        response = self.get_response(request)
        return response
