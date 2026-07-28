from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import authenticate, get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from .serializers import RegisterSerializer, LoginSerializer
import random
import string
from django.core.cache import cache
from .email_service import EmailService
from django.db import IntegrityError
from rest_framework.permissions import IsAuthenticated

User = get_user_model()


class RegisterView(APIView):
    """
    Vue pour l'inscription des utilisateurs.
    POST /api/auth/register/
    """
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        
        if serializer.is_valid():
            try:
                user = serializer.save()
                
                # Générer un token JWT
                refresh = RefreshToken.for_user(user)
                # Ajouter les claims personnalisés au token
                refresh['platform_role'] = user.platform_role or ''
                refresh['role'] = user.get_primary_role()
                refresh['is_superuser'] = user.is_superuser
                access_token = str(refresh.access_token)

                return Response({
                    'token': access_token,
                    'refresh_token': str(refresh),
                    'user': {
                        'id': user.id,
                        'email': user.email,
                        'first_name': user.first_name,
                        'last_name': user.last_name,
                        'nom_societe': user.nom_societe
                    }
                }, status=status.HTTP_201_CREATED)
            
            except IntegrityError as e:
                # Gérer les erreurs de contrainte unique (email déjà utilisé)
                error_message = str(e)
                
                if 'username' in error_message or 'email' in error_message:
                    return Response({
                        'detail': 'Cet email est déjà utilisé. Veuillez utiliser un autre email ou vous connecter.',
                        'code': 'EMAIL_ALREADY_EXISTS',
                        'field': 'email'
                    }, status=status.HTTP_400_BAD_REQUEST)
                else:
                    return Response({
                        'detail': 'Une erreur de base de données est survenue. Veuillez réessayer.',
                        'code': 'DATABASE_ERROR'
                    }, status=status.HTTP_400_BAD_REQUEST)
            
            except Exception as e:
                # Gérer les autres erreurs inattendues
                print(f"Erreur lors de l'inscription: {str(e)}")
                return Response({
                    'detail': 'Une erreur inattendue est survenue. Veuillez réessayer plus tard.',
                    'code': 'UNEXPECTED_ERROR'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        # Erreurs de validation du sérialiseur
        errors = serializer.errors
        
        # Formater les erreurs pour le frontend
        formatted_errors = {}
        
        if 'email' in errors:
            formatted_errors['email'] = 'Cet email est déjà utilisé ou invalide.'
        elif 'password' in errors:
            formatted_errors['password'] = 'Le mot de passe ne respecte pas les critères de sécurité.'
        elif 'non_field_errors' in errors:
            formatted_errors['general'] = errors['non_field_errors'][0]
        else:
            # Prendre la première erreur disponible
            first_field = list(errors.keys())[0]
            formatted_errors['general'] = f"Erreur dans le champ {first_field}: {errors[first_field][0]}"
        
        return Response(formatted_errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    """
    Vue pour la connexion des utilisateurs.
    POST /api/auth/login/
    """
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if serializer.is_valid():
            email = serializer.validated_data['email']
            password = serializer.validated_data['password']
            
            # Vérifier si l'email existe dans la BDD
            from django.contrib.auth import get_user_model
            User = get_user_model()
            
            try:
                user = User.objects.get(email=email)
                # Email trouvé, vérifier le mot de passe
                authenticated_user = authenticate(username=email, password=password)
                
                if authenticated_user is not None:
                    # Mot de passe correct - Générer un token JWT
                    refresh = RefreshToken.for_user(authenticated_user)
                    # Ajouter les claims personnalisés au token
                    refresh['platform_role'] = authenticated_user.platform_role or ''
                    refresh['role'] = authenticated_user.get_primary_role()
                    refresh['is_superuser'] = authenticated_user.is_superuser
                    access_token = str(refresh.access_token)
                    
                    # Mettre à jour la date de dernière connexion
                    if hasattr(authenticated_user, 'update_last_connection'):
                        authenticated_user.update_last_connection()
                    
                    return Response({
                        'token': access_token,
                        'refresh_token': str(refresh),
                        'user': {
                            'id': authenticated_user.id,
                            'email': authenticated_user.email,
                            'first_name': authenticated_user.first_name,
                            'last_name': authenticated_user.last_name,
                            'nom_societe': authenticated_user.nom_societe
                        }
                    }, status=status.HTTP_200_OK)
                else:
                    # Email correct mais mot de passe incorrect
                    return Response(
                        {
                            'detail': 'Mot de passe incorrect.',
                            'message': 'Le mot de passe saisi ne correspond pas à cet email. Veuillez réessayer ou cliquez sur "Mot de passe oublié".',
                            'code': 'INVALID_PASSWORD'
                        },
                        status=status.HTTP_401_UNAUTHORIZED
                    )
                    
            except User.DoesNotExist:
                # Email n'existe pas dans la BDD
                return Response(
                    {
                        'detail': 'Email non trouvé.',
                        'message': 'Aucun compte n\'est associé à cette adresse email. Veuillez vérifier l\'email saisi ou créer un compte.',
                        'code': 'EMAIL_NOT_FOUND',
                        'suggestion': 'Créer un compte'
                    },
                    status=status.HTTP_404_NOT_FOUND
                )
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ForgotPasswordView(APIView):
    """
    Vue pour demander la réinitialisation du mot de passe.
    POST /api/auth/forgot-password/
    """
    def post(self, request):
        email = request.data.get('email')
        
        if not email:
            return Response(
                {'detail': 'Email requis.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Pour la sécurité, ne pas révéler si l'email existe
            return Response({
                'detail': 'Si cet email existe, un code a été envoyé.'
            }, status=status.HTTP_200_OK)
        
        # Générer un code à 6 chiffres
        code = ''.join(random.choices(string.digits, k=6))
        
        # Stocker le code dans le cache (expire dans 10 minutes)
        cache.set(f'reset_code_{email}', code, timeout=600)
        
        # Envoyer l'email avec le code
        email_service = EmailService()
        email_sent = email_service.send_password_reset_code(
            to_email=email,
            code=code,
            username=f"{user.first_name} {user.last_name}" if user.first_name or user.last_name else None
        )
        
        if email_sent:
            return Response({
                'detail': 'Un code de vérification a été envoyé à votre email.',
                'message': 'Vérifiez votre boîte de réception (et vos spams)'
            }, status=status.HTTP_200_OK)
        else:
            # Fallback: afficher dans la console en cas d'échec d'envoi
            print(f"\n{'='*50}")
            print(f"⚠️  EMAIL NON ENVOYÉ - CODE DE RÉINITIALISATION pour {email}: {code}")
            print(f"{'='*50}\n")
            
            return Response({
                'detail': 'Un code de vérification a été généré.',
                'message': 'MODE TEST: Vérifiez la console backend pour le code',
                'code': code  # Seulement en développement!
            }, status=status.HTTP_200_OK)


class VerifyCodeView(APIView):
    """
    Vue pour vérifier le code de réinitialisation.
    POST /api/auth/verify-code/
    """
    def post(self, request):
        email = request.data.get('email')
        code = request.data.get('code')
        
        if not email or not code:
            return Response(
                {'detail': 'Email et code requis.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Récupérer le code du cache
        stored_code = cache.get(f'reset_code_{email}')
        
        if not stored_code or stored_code != code:
            return Response(
                {'detail': 'Code invalide ou expiré.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Générer un token temporaire pour la réinitialisation
        refresh = RefreshToken.for_user(User.objects.get(email=email))
        temp_token = str(refresh.access_token)
        
        # Stocker le token pour validation ultérieure
        cache.set(f'reset_token_{email}', temp_token, timeout=300)
        
        return Response({
            'detail': 'Code vérifié avec succès.',
            'token': temp_token
        }, status=status.HTTP_200_OK)


class ResetPasswordView(APIView):
    """
    Vue pour réinitialiser le mot de passe.
    POST /api/auth/reset-password/
    """
    def post(self, request):
        email = request.data.get('email')
        token = request.data.get('token')
        new_password = request.data.get('new_password')
        
        if not all([email, token, new_password]):
            return Response(
                {'detail': 'Tous les champs sont requis.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Vérifier le token
        stored_token = cache.get(f'reset_token_{email}')
        
        if not stored_token or stored_token != token:
            return Response(
                {'detail': 'Token invalide ou expiré.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            user = User.objects.get(email=email)
            user.set_password(new_password)
            user.save()
            
            # Supprimer le token utilisé
            cache.delete(f'reset_token_{email}')
            cache.delete(f'reset_code_{email}')
            
            return Response({
                'detail': 'Mot de passe réinitialisé avec succès.'
            }, status=status.HTTP_200_OK)
            
        except User.DoesNotExist:
            return Response(
                {'detail': 'Utilisateur non trouvé.'}, 
                status=status.HTTP_404_NOT_FOUND
            )


class ChangePasswordView(APIView):
    """
    Vue pour changer le mot de passe (première connexion ou changement volontaire).
    POST /api/auth/change-password/
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        user = request.user
        current_password = request.data.get('current_password')
        new_password = request.data.get('new_password')
        
        # Validation des champs requis
        if not all([current_password, new_password]):
            return Response(
                {'detail': 'Mot de passe actuel et nouveau mot de passe requis.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Vérifier le mot de passe actuel
        if not user.check_password(current_password):
            return Response(
                {'detail': 'Mot de passe actuel incorrect.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Valider la force du nouveau mot de passe
        if len(new_password) < 8:
            return Response(
                {'detail': 'Le mot de passe doit contenir au moins 8 caractères.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Définir le nouveau mot de passe
        user.set_password(new_password)
        
        # IMPORTANT: Sauvegarder le nouveau mot de passe dans la BDD
        user.save(update_fields=['password'])
        
        # Marquer comme changé (désactive must_change_password)
        if hasattr(user, 'mark_password_changed'):
            user.mark_password_changed()
        else:
            user.must_change_password = False
            from django.utils import timezone
            user.password_changed_at = timezone.now()
            user.save(update_fields=['must_change_password', 'password_changed_at'])
        
        return Response({
            'detail': 'Mot de passe changé avec succès.',
            'message': 'Vous pouvez maintenant accéder à l\'application.'
        }, status=status.HTTP_200_OK)


class UserProfileView(APIView):
    """
    Vue pour récupérer le profil de l'utilisateur authentifié.
    GET /api/auth/me/
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        user = request.user

        profile_picture_url = None
        if getattr(user, 'profile_picture', None):
            profile_picture_url = request.build_absolute_uri(user.profile_picture.url)

        organization = user.get_primary_organization()

        return Response({
            'id': user.id,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'role': user.get_primary_role(),
            'role_display': user.get_primary_role_display(),
            'organization_id': str(organization.id) if organization else None,
            'organization_name': organization.name if organization else None,
            'profile_picture_url': profile_picture_url,
            'must_change_password': getattr(user, 'must_change_password', False),
            'password_changed_at': getattr(user, 'password_changed_at', None),
            'piece_sort_config': getattr(user, 'piece_sort_config', None) or {},
            'piece_fields_config': getattr(user, 'piece_fields_config', None) or {},
        }, status=status.HTTP_200_OK)


class PieceSortConfigView(APIView):
    """Préférences de tri par défaut des tableaux de pièces de l'opérateur connecté.

    GET/PUT /api/auth/me/piece-sort-config/
    Corps PUT, deux formes acceptées par type de pièce :
    - liste : `{ '<TYPE>': [ {'field', 'dir'}, … ] }` (version brute uniquement) ;
    - objet à deux versions (RDL/RDN/RDIA) :
      `{ '<TYPE>': { 'brut': [ … ], 'ecarts': [ … ] } }`.
    Plusieurs niveaux ordonnés (niveau 1 prioritaire). L'ancienne forme { type: {field, dir} }
    reste tolérée (normalisée en liste à un niveau).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(request.user.piece_sort_config or {}, status=status.HTTP_200_OK)

    @staticmethod
    def _clean_levels(raw, valid, type_piece, version_label):
        """Nettoie/valide une liste de niveaux de tri contre l'ensemble `valid` des champs
        autorisés. Renvoie (levels, error_response|None)."""
        levels = raw if isinstance(raw, list) else ([raw] if raw else [])
        out, seen = [], set()
        for lv in levels:
            if not isinstance(lv, dict):
                return None, Response(
                    {'detail': f"Niveau de tri invalide pour « {type_piece} »{version_label}."},
                    status=status.HTTP_400_BAD_REQUEST)
            field = (lv.get('field') or '').strip()
            if not field:
                continue
            if field not in valid:
                return None, Response(
                    {'detail': f"Champ de tri « {field} » invalide pour « {type_piece} »{version_label}."},
                    status=status.HTTP_400_BAD_REQUEST)
            if field in seen:
                continue  # un même champ ne peut apparaître qu'une fois
            seen.add(field)
            direction = (lv.get('dir') or 'asc').strip().lower()
            out.append({'field': field, 'dir': direction if direction in ('asc', 'desc') else 'asc'})
        return out, None

    def put(self, request):
        from pieces.catalog import get_piece_def, valid_field_names
        data = request.data or {}
        if not isinstance(data, dict):
            return Response({'detail': 'Un objet { type: [ {field, dir}, … ] } est attendu.'},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned = {}
        for type_piece, entry in data.items():
            if entry in (None, '', {}, []):
                continue  # type sans tri configuré : on l'omet
            try:
                piece_def = get_piece_def(type_piece)
            except KeyError:
                return Response({'detail': f"Type de pièce inconnu : « {type_piece} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            # Champs EFFECTIFS (statiques + personnalisés App Admin) → un champ perso est triable.
            valid_brut = valid_field_names(type_piece, 'brut')
            has_ecarts = bool(piece_def.get('ecarts'))
            valid_ecarts = valid_field_names(type_piece, 'ecarts')

            # Forme à deux versions { 'brut': [...], 'ecarts': [...] } (RDL/RDN/RDIA).
            if isinstance(entry, dict) and ('brut' in entry or 'ecarts' in entry):
                brut, err = self._clean_levels(entry.get('brut'), valid_brut, type_piece, ' (version brute)')
                if err:
                    return err
                ecarts = []
                if has_ecarts:
                    ecarts, err = self._clean_levels(entry.get('ecarts'), valid_ecarts, type_piece, ' (version écarts)')
                    if err:
                        return err
                if brut or ecarts:
                    cleaned[type_piece] = {'brut': brut, 'ecarts': ecarts} if ecarts else brut
                continue

            # Forme liste (version brute uniquement) ou ancien objet unique {field, dir}.
            brut, err = self._clean_levels(entry, valid_brut, type_piece, '')
            if err:
                return err
            if brut:
                cleaned[type_piece] = brut
        request.user.piece_sort_config = cleaned
        request.user.save(update_fields=['piece_sort_config'])
        return Response(cleaned, status=status.HTTP_200_OK)


class PieceSortConfigResetView(APIView):
    """Réinitialise le tri par défaut de l'opérateur connecté avec la configuration SOURCE
    (celle du compte super admin, cf. accounts.piece_defaults).

    POST /api/auth/me/piece-sort-config/reset/ → renvoie la configuration appliquée. Erreur
    400 si aucune configuration source n'est disponible (pour ne pas vider silencieusement le
    tri de l'utilisateur)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import copy
        from .piece_defaults import superadmin_piece_sort_config
        source = superadmin_piece_sort_config()
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de tri par défaut configuré."},
                status=status.HTTP_400_BAD_REQUEST)
        request.user.piece_sort_config = copy.deepcopy(source)
        request.user.save(update_fields=['piece_sort_config'])
        return Response(request.user.piece_sort_config, status=status.HTTP_200_OK)


class PieceFieldsConfigView(APIView):
    """Champs (colonnes) par défaut à afficher par type de pièce et par vue.

    GET/PUT /api/auth/me/piece-fields-config/
    Corps PUT :
      `{ '<TYPE>': { 'app': {'brut': [<noms>], 'ecarts': [<noms>]},
                     'pdf': {'brut': [<noms>], 'ecarts': [<noms>]} } }`
    Une liste = colonnes VISIBLES dans cet ORDRE pour la vue/version. Vue/version
    omise = tous les champs du catalogue (ordre catalogue). Chaque nom est validé
    contre les champs (`champs` / `ecarts_champs`) du type ; les doublons sont
    supprimés et la version `ecarts` est ignorée si le type n'en a pas.
    """
    permission_classes = [IsAuthenticated]

    # Vues configurables. `import` (version brute) est le FILTRE-MAÎTRE : les champs non
    # importés ne peuvent apparaître ni dans `app` ni dans `pdf` (cascade appliquée au PUT).
    VIEWS = ('import', 'app', 'pdf')

    def get(self, request):
        return Response(request.user.piece_fields_config or {}, status=status.HTTP_200_OK)

    @staticmethod
    def _clean_names(raw, valid_order, type_piece, view, version_label):
        """Filtre/déduplique une liste de noms de champs contre `valid_order` (ordre
        catalogue = ensemble des noms autorisés). Renvoie (names, error_response|None).
        L'ordre retenu est celui fourni par le client (réordonnancement opérateur)."""
        if raw is None:
            return None, None  # version non fournie : on l'omet (= tous par défaut)
        if not isinstance(raw, list):
            return None, Response(
                {'detail': f"Liste de champs invalide pour « {type_piece} » (vue {view}{version_label})."},
                status=status.HTTP_400_BAD_REQUEST)
        valid = set(valid_order)
        out, seen = [], set()
        for name in raw:
            name = (name or '').strip() if isinstance(name, str) else ''
            if not name or name in seen:
                continue
            if name not in valid:
                return None, Response(
                    {'detail': f"Champ « {name} » invalide pour « {type_piece} » (vue {view}{version_label})."},
                    status=status.HTTP_400_BAD_REQUEST)
            seen.add(name)
            out.append(name)
        return out, None

    def put(self, request):
        from pieces.catalog import get_piece_def, effective_champs, required_field_names
        data = request.data or {}
        if not isinstance(data, dict):
            return Response({'detail': "Un objet { type: { app|pdf: { brut|ecarts: [...] } } } est attendu."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned = {}
        for type_piece, entry in data.items():
            if entry in (None, '', {}, []):
                continue
            try:
                piece_def = get_piece_def(type_piece)
            except KeyError:
                return Response({'detail': f"Type de pièce inconnu : « {type_piece} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if not isinstance(entry, dict):
                return Response({'detail': f"Configuration invalide pour « {type_piece} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            # Champs EFFECTIFS (statiques + personnalisés) pour la version brute → les champs
            # ajoutés par l'App Admin sont configurables dans « Champs par défaut ».
            order_brut = [c['name'] for c in effective_champs(type_piece)]
            has_ecarts = bool(piece_def.get('ecarts'))
            order_ecarts = [c['name'] for c in (piece_def.get('ecarts_champs') or [])]
            required = required_field_names(type_piece)

            type_out = {}

            # 1) Vue « import » = FILTRE-MAÎTRE (version brute uniquement). Les champs `required`
            #    sont toujours réinjectés (verrouillés) ; les vues app/pdf s'y restreignent ensuite.
            import_names = None
            import_entry = entry.get('import')
            if isinstance(import_entry, dict):
                brut, err = self._clean_names(import_entry.get('brut'), order_brut,
                                              type_piece, 'import', ' brut')
                if err:
                    return err
                if brut is not None:
                    missing = [n for n in order_brut if n in required and n not in brut]
                    import_names = missing + brut
                    type_out['import'] = {'brut': import_names}
            # Ensemble autorisé (cascade) : champs importés, ou tous si aucune vue import.
            import_allowed = set(import_names) if import_names is not None else set(order_brut)

            # 2) Vues app / pdf : sous-ensembles de la vue import (cascade). Un champ non
            #    importé est retiré silencieusement (il ne peut être affiché/imprimé).
            for view in ('app', 'pdf'):
                view_entry = entry.get(view)
                if not isinstance(view_entry, dict):
                    continue
                view_out = {}
                brut, err = self._clean_names(view_entry.get('brut'), order_brut,
                                              type_piece, view, ' brut')
                if err:
                    return err
                if brut is not None:
                    view_out['brut'] = [n for n in brut if n in import_allowed]
                if has_ecarts:
                    ecarts, err = self._clean_names(view_entry.get('ecarts'), order_ecarts,
                                                    type_piece, view, ' écarts')
                    if err:
                        return err
                    if ecarts is not None:
                        view_out['ecarts'] = ecarts
                if view_out:
                    type_out[view] = view_out
            if type_out:
                cleaned[type_piece] = type_out
        request.user.piece_fields_config = cleaned
        request.user.save(update_fields=['piece_fields_config'])
        return Response(cleaned, status=status.HTTP_200_OK)


class PieceFieldsConfigResetView(APIView):
    """Réinitialise la config des CHAMPS (colonnes) de l'opérateur connecté avec la
    configuration SOURCE (celle du compte super admin, cf. accounts.piece_defaults).

    POST /api/auth/me/piece-fields-config/reset/ → renvoie la configuration appliquée. Erreur
    400 si aucune configuration source n'est disponible (pour ne pas vider silencieusement la
    config de l'utilisateur). Calqué sur PieceSortConfigResetView."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import copy
        from .piece_defaults import superadmin_piece_fields_config
        source = superadmin_piece_fields_config()
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de champs par défaut configurés."},
                status=status.HTTP_400_BAD_REQUEST)
        request.user.piece_fields_config = copy.deepcopy(source)
        request.user.save(update_fields=['piece_fields_config'])
        return Response(request.user.piece_fields_config, status=status.HTTP_200_OK)


# Colonnes triables du tableau de la liste des SSDGPS (allowlist de validation serveur).
SSDGPS_SORT_FIELDS = {
    'numero_ssdgps', 'nature_ssdgps', 'type_ssdgps', 'propriete_label', 'affaire_numero',
    'nbr_total_sessions', 'nbr_total_pieces', 'propriete_nom', 'propriete_id_titre',
    'propriete_id_requisition', 'created_at', 'updated_at',
}


class SsdgpsSortConfigView(APIView):
    """Tri MULTI-NIVEAUX par défaut du tableau de la liste des SSDGPS, propre à l'opérateur.

    GET/PUT /api/auth/me/ssdgps-sort-config/
    Corps PUT : liste ordonnée `[{'field': '<colonne>', 'dir': 'asc'|'desc'}, ..]` (niveau 1 =
    prioritaire). Champs validés contre `SSDGPS_SORT_FIELDS` ; doublons supprimés ; `dir`
    normalisé (défaut 'asc')."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(request.user.ssdgps_sort_config or [], status=status.HTTP_200_OK)

    def put(self, request):
        data = request.data
        if not isinstance(data, list):
            return Response({'detail': "Une liste de niveaux [{field, dir}] est attendue."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned, seen = [], set()
        for level in data:
            if not isinstance(level, dict):
                return Response({'detail': "Chaque niveau doit être un objet {field, dir}."},
                                status=status.HTTP_400_BAD_REQUEST)
            field = (level.get('field') or '').strip()
            if field not in SSDGPS_SORT_FIELDS:
                return Response({'detail': f"Champ de tri invalide : « {field} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if field in seen:
                continue  # un champ ne peut apparaître qu'une fois
            seen.add(field)
            cleaned.append({'field': field, 'dir': 'desc' if level.get('dir') == 'desc' else 'asc'})
        request.user.ssdgps_sort_config = cleaned
        request.user.save(update_fields=['ssdgps_sort_config'])
        return Response(cleaned, status=status.HTTP_200_OK)


class SsdgpsSortConfigResetView(APIView):
    """Réinitialise le tri multi-niveaux de la liste des SSDGPS de l'opérateur avec la
    configuration SOURCE (compte super admin). POST .../reset/ → config appliquée, ou 400 si
    aucune source disponible."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import copy
        from .piece_defaults import superadmin_ssdgps_sort_config
        source = superadmin_ssdgps_sort_config()
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de tri des SSDGPS configuré."},
                status=status.HTTP_400_BAD_REQUEST)
        request.user.ssdgps_sort_config = copy.deepcopy(source)
        request.user.save(update_fields=['ssdgps_sort_config'])
        return Response(request.user.ssdgps_sort_config, status=status.HTTP_200_OK)


# Colonnes triables du tableau de la liste des ORGANISATIONS (allowlist de validation serveur).
ORG_SORT_FIELDS = {
    'code', 'name', 'type_display', 'legal_id', 'address', 'phone', 'email', 'website',
    'is_active', 'member_count',
    # Colonnes d'audit standard (cf. CLAUDE.md) ; `modified_by_email` conservé pour compatibilité.
    'created_at', 'updated_at', 'is_deleted', 'deleted_at',
    'created_by_email', 'modified_by_email', 'updated_by_email', 'deleted_by_email',
}


class OrgSortConfigView(APIView):
    """Tri MULTI-NIVEAUX par défaut du tableau de la liste des ORGANISATIONS, propre à l'opérateur.

    GET/PUT /api/auth/me/org-sort-config/
    Corps PUT : liste ordonnée `[{'field': '<colonne>', 'dir': 'asc'|'desc'}, ..]` (niveau 1 =
    prioritaire). Champs validés contre `ORG_SORT_FIELDS` ; doublons supprimés ; `dir`
    normalisé (défaut 'asc'). Miroir de `SsdgpsSortConfigView`."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(request.user.org_sort_config or [], status=status.HTTP_200_OK)

    def put(self, request):
        data = request.data
        if not isinstance(data, list):
            return Response({'detail': "Une liste de niveaux [{field, dir}] est attendue."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned, seen = [], set()
        for level in data:
            if not isinstance(level, dict):
                return Response({'detail': "Chaque niveau doit être un objet {field, dir}."},
                                status=status.HTTP_400_BAD_REQUEST)
            field = (level.get('field') or '').strip()
            if field not in ORG_SORT_FIELDS:
                return Response({'detail': f"Champ de tri invalide : « {field} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if field in seen:
                continue  # un champ ne peut apparaître qu'une fois
            seen.add(field)
            cleaned.append({'field': field, 'dir': 'desc' if level.get('dir') == 'desc' else 'asc'})
        request.user.org_sort_config = cleaned
        request.user.save(update_fields=['org_sort_config'])
        return Response(cleaned, status=status.HTTP_200_OK)


class OrgSortConfigResetView(APIView):
    """Réinitialise le tri multi-niveaux de la liste des ORGANISATIONS de l'opérateur avec la
    configuration SOURCE (compte super admin). POST .../reset/ → config appliquée, ou 400 si
    aucune source disponible."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import copy
        from .piece_defaults import superadmin_org_sort_config
        source = superadmin_org_sort_config()
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de tri des organisations configuré."},
                status=status.HTTP_400_BAD_REQUEST)
        request.user.org_sort_config = copy.deepcopy(source)
        request.user.save(update_fields=['org_sort_config'])
        return Response(request.user.org_sort_config, status=status.HTTP_200_OK)


# Colonnes triables des tableaux des listes d'ORGANISMES (allowlists de validation serveur).
# Les colonnes triables diffèrent selon le niveau (le niveau 2 ajoute `niveau1_nom`/`ville`,
# le niveau 1 ajoute `nbr_niveaux2`).
ORGANISME_N1_SORT_FIELDS = {
    'code', 'nom', 'sigle', 'nbr_niveaux2', 'is_active',
    'created_at', 'created_by_email', 'updated_at', 'updated_by_email',
    'deleted_at', 'deleted_by_email',
}
ORGANISME_N2_SORT_FIELDS = {
    'code', 'nom', 'niveau1_nom', 'niveau1_sigle', 'ville', 'sigle', 'is_active',
    'created_at', 'created_by_email', 'updated_at', 'updated_by_email',
    'deleted_at', 'deleted_by_email',
}

# Par niveau (1 / 2) : nom du champ modèle, allowlist et fonction source (super admin).
_ORGANISME_SORT_BY_NIVEAU = {
    1: ('organisme_niveau1_sort_config', ORGANISME_N1_SORT_FIELDS, 'niveau1'),
    2: ('organisme_niveau2_sort_config', ORGANISME_N2_SORT_FIELDS, 'niveau2'),
}


class OrganismeSortConfigView(APIView):
    """Tri MULTI-NIVEAUX par défaut des tableaux des listes d'ORGANISMES, propre à l'opérateur.

    GET/PUT /api/auth/me/organisme-sort-config/<niveau>/  (niveau ∈ {1, 2})
    Corps PUT : liste ordonnée `[{'field': '<colonne>', 'dir': 'asc'|'desc'}, ..]` (niveau 1 =
    prioritaire). Champs validés contre l'allowlist du niveau ; doublons supprimés ; `dir`
    normalisé (défaut 'asc'). Miroir de `OrgSortConfigView`."""
    permission_classes = [IsAuthenticated]

    def _resolve(self, niveau):
        return _ORGANISME_SORT_BY_NIVEAU.get(niveau)

    def get(self, request, niveau):
        cfg = self._resolve(niveau)
        if not cfg:
            return Response({'detail': "Niveau d'organisme invalide (attendu 1 ou 2)."},
                            status=status.HTTP_400_BAD_REQUEST)
        attr, _fields, _src = cfg
        return Response(getattr(request.user, attr) or [], status=status.HTTP_200_OK)

    def put(self, request, niveau):
        cfg = self._resolve(niveau)
        if not cfg:
            return Response({'detail': "Niveau d'organisme invalide (attendu 1 ou 2)."},
                            status=status.HTTP_400_BAD_REQUEST)
        attr, allowed, _src = cfg
        data = request.data
        if not isinstance(data, list):
            return Response({'detail': "Une liste de niveaux [{field, dir}] est attendue."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned, seen = [], set()
        for level in data:
            if not isinstance(level, dict):
                return Response({'detail': "Chaque niveau doit être un objet {field, dir}."},
                                status=status.HTTP_400_BAD_REQUEST)
            field = (level.get('field') or '').strip()
            if field not in allowed:
                return Response({'detail': f"Champ de tri invalide : « {field} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if field in seen:
                continue  # un champ ne peut apparaître qu'une fois
            seen.add(field)
            cleaned.append({'field': field, 'dir': 'desc' if level.get('dir') == 'desc' else 'asc'})
        setattr(request.user, attr, cleaned)
        request.user.save(update_fields=[attr])
        return Response(cleaned, status=status.HTTP_200_OK)


class OrganismeSortConfigResetView(APIView):
    """Réinitialise le tri multi-niveaux d'une liste d'organismes de l'opérateur avec la
    configuration SOURCE (compte super admin). POST .../<niveau>/reset/ → config appliquée, ou
    400 si aucune source disponible."""
    permission_classes = [IsAuthenticated]

    def post(self, request, niveau):
        import copy
        from .piece_defaults import (
            superadmin_organisme_niveau1_sort_config,
            superadmin_organisme_niveau2_sort_config,
        )
        cfg = _ORGANISME_SORT_BY_NIVEAU.get(niveau)
        if not cfg:
            return Response({'detail': "Niveau d'organisme invalide (attendu 1 ou 2)."},
                            status=status.HTTP_400_BAD_REQUEST)
        attr, _fields, _src = cfg
        source = (superadmin_organisme_niveau1_sort_config() if niveau == 1
                  else superadmin_organisme_niveau2_sort_config())
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de tri des organismes configuré."},
                status=status.HTTP_400_BAD_REQUEST)
        setattr(request.user, attr, copy.deepcopy(source))
        request.user.save(update_fields=[attr])
        return Response(getattr(request.user, attr), status=status.HTTP_200_OK)


# ============================================================================
# Tri MULTI-NIVEAUX GÉNÉRIQUE par tableau (utilisateurs, projets, explorateur, ...)
# ----------------------------------------------------------------------------
# Un seul champ `CustomUser.table_sort_configs` (dict `{clé: [{field,dir}]}`) et un seul couple
# de vues, plutôt qu'un champ + une migration + une vue par nouvelle liste. Chaque tableau
# déclare son allowlist de colonnes triables dans `TABLE_SORT_FIELDS`. Même contrat que les vues
# dédiées (validation, doublons supprimés, `dir` normalisé, réinitialisation depuis le super admin).
# ============================================================================
TABLE_SORT_FIELDS = {
    # Liste des UTILISATEURS (features/admin/users/user-list).
    'users': {
        'first_name', 'email', 'role', 'organization_name', 'is_active',
        'last_connection_at', 'must_change_password', 'date_joined',
        'password_changed_at', 'is_deleted', 'is_superuser',
    },
    # Liste des PROJETS (features/projects/project-list).
    'projects': {
        'code_projet', 'nom_projet', 'statut', 'organization_name',
        'nbr_total_proprietes', 'nbr_total_affaires', 'nbr_total_ssdgps',
        'nbr_total_sessions', 'nbr_total_pieces', 'created_at', 'updated_at',
        'is_deleted', 'deleted_at', 'created_by_email', 'updated_by_email',
        'deleted_by_email',
    },
    # EXPLORATEUR de projet — un tableau par niveau (colonnes distinctes).
    'project_proprietes': {
        'nom_propriete', 'id_propriete', 'id_requisition', 'id_titre', 'nbr_total_affaires',
        'nbr_total_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces', 'created_at', 'updated_at',
        'is_deleted', 'deleted_at', 'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    'project_affaires': {
        'numero_sd_affaire', 'nature_procedure_affaire', 'nature_affaire', 'date_bornage',
        'nbr_total_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces', 'created_at', 'updated_at',
        'is_deleted', 'deleted_at', 'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    'project_ssdgps': {
        'nature_ssdgps', 'numero_ssdgps', 'type_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    'project_sessions': {
        'numero_session', 'date_session', 'nbr_total_pieces',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    # Liste des PIÈCES d'un rapport SSDGPS (features/projects/piece-management-page). NB : distinct
    # du tri des DONNÉES internes d'une pièce (piece_sort_config, par type, via Profil).
    'pieces': {
        'ordre', 'type_piece_display', 'numero', 'portee_label', 'source_saisie', 'statut',
        'commentaire', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
}


class TableSortConfigView(APIView):
    """Tri MULTI-NIVEAUX par défaut d'un tableau GÉNÉRIQUE, propre à l'opérateur.

    GET/PUT /api/auth/me/table-sort-config/<key>/  (key ∈ clés de `TABLE_SORT_FIELDS`)
    Corps PUT : liste ordonnée `[{'field': '<colonne>', 'dir': 'asc'|'desc'}, ..]` (niveau 1 =
    prioritaire). Champs validés contre l'allowlist de la clé ; doublons supprimés ; `dir`
    normalisé (défaut 'asc'). Stocké dans `CustomUser.table_sort_configs[<key>]`. Miroir des vues
    dédiées (organisations/organismes/SSDGPS)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, key):
        if key not in TABLE_SORT_FIELDS:
            return Response({'detail': f"Tableau inconnu : « {key} »."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response((request.user.table_sort_configs or {}).get(key, []),
                        status=status.HTTP_200_OK)

    def put(self, request, key):
        allowed = TABLE_SORT_FIELDS.get(key)
        if allowed is None:
            return Response({'detail': f"Tableau inconnu : « {key} »."},
                            status=status.HTTP_400_BAD_REQUEST)
        data = request.data
        if not isinstance(data, list):
            return Response({'detail': "Une liste de niveaux [{field, dir}] est attendue."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned, seen = [], set()
        for level in data:
            if not isinstance(level, dict):
                return Response({'detail': "Chaque niveau doit être un objet {field, dir}."},
                                status=status.HTTP_400_BAD_REQUEST)
            field = (level.get('field') or '').strip()
            if field not in allowed:
                return Response({'detail': f"Champ de tri invalide : « {field} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if field in seen:
                continue  # un champ ne peut apparaître qu'une fois
            seen.add(field)
            cleaned.append({'field': field, 'dir': 'desc' if level.get('dir') == 'desc' else 'asc'})
        configs = dict(request.user.table_sort_configs or {})
        configs[key] = cleaned
        request.user.table_sort_configs = configs
        request.user.save(update_fields=['table_sort_configs'])
        return Response(cleaned, status=status.HTTP_200_OK)


class TableSortConfigResetView(APIView):
    """Réinitialise le tri multi-niveaux d'un tableau générique de l'opérateur avec la
    configuration SOURCE (compte super admin). POST .../<key>/reset/ → config appliquée, ou 400 si
    clé inconnue / aucune source disponible."""
    permission_classes = [IsAuthenticated]

    def post(self, request, key):
        import copy
        from .piece_defaults import superadmin_table_sort_config
        if key not in TABLE_SORT_FIELDS:
            return Response({'detail': f"Tableau inconnu : « {key} »."},
                            status=status.HTTP_400_BAD_REQUEST)
        source = superadmin_table_sort_config(key)
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de tri configuré pour ce tableau."},
                status=status.HTTP_400_BAD_REQUEST)
        configs = dict(request.user.table_sort_configs or {})
        configs[key] = copy.deepcopy(source)
        request.user.table_sort_configs = configs
        request.user.save(update_fields=['table_sort_configs'])
        return Response(configs[key], status=status.HTTP_200_OK)


# ============================================================================
# Configuration des COLONNES GÉNÉRIQUE par tableau (visibilité + ordre)
# ----------------------------------------------------------------------------
# Miroir de `table_sort_configs` : un seul champ `CustomUser.table_columns_configs`
# (dict `{clé: [{field, visible}]}`, l'ordre de la liste = ordre d'affichage) et un couple de
# vues pour TOUS les tableaux. Chaque tableau déclare le catalogue COMPLET de ses colonnes
# (colonnes triables ET non triables) dans `TABLE_COLUMN_FIELDS`. La source d'héritage /
# réinitialisation est la configuration du compte super admin (comme le tri).
# ============================================================================
TABLE_COLUMN_FIELDS = {
    # Liste des ORGANISATIONS (features/dashboard/organization-list).
    'organizations': {
        'code', 'name', 'type_display', 'legal_id', 'address', 'phone', 'email', 'website',
        'is_active', 'member_count',
        # Colonnes d'audit standard (cf. CLAUDE.md). `modified_by_email` est conservé pour
        # compatibilité, `updated_by_email` est le nom unifié.
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'modified_by_email', 'updated_by_email', 'deleted_by_email',
    },
    # Listes des ORGANISMES niveau 1 / niveau 2 (features/admin/organismes/organisme-list).
    'organisme_niveau1': {
        'code', 'nom', 'sigle', 'nbr_niveaux2', 'is_active',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    'organisme_niveau2': {
        'code', 'nom', 'niveau1_nom', 'niveau1_sigle', 'ville', 'sigle', 'is_active',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    # Liste des UTILISATEURS (features/admin/users/user-list).
    'users': {
        'first_name', 'email', 'role', 'organization_name', 'is_active', 'last_connection_at',
        'must_change_password', 'date_joined', 'password_changed_at', 'is_superuser',
        # Colonnes d'audit standard (cf. CLAUDE.md).
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    # Liste des PROJETS (features/projects/project-list).
    'projects': {
        'code_projet', 'nom_projet', 'statut', 'organization_name', 'nbr_total_proprietes',
        'nbr_total_affaires', 'nbr_total_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'created_by_email',
        'updated_by_email', 'deleted_by_email',
    },
    # EXPLORATEUR de projet — un tableau par niveau (colonnes distinctes).
    'project_proprietes': {
        'nom_propriete', 'id_propriete', 'id_requisition', 'id_titre', 'nbr_total_affaires',
        'nbr_total_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    'project_affaires': {
        'numero_sd_affaire', 'nature_procedure_affaire', 'nature_affaire', 'date_bornage',
        'nbr_total_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces',
        'created_at', 'updated_at', 'is_deleted',
        'deleted_at', 'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    'project_ssdgps': {
        'nature_ssdgps', 'numero_ssdgps', 'type_ssdgps', 'nbr_total_sessions', 'nbr_total_pieces',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'created_by_email',
        'updated_by_email', 'deleted_by_email',
    },
    'project_sessions': {
        'numero_session', 'date_session', 'nbr_total_pieces', 'created_at', 'updated_at',
        'is_deleted', 'deleted_at', 'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    # Liste des SSDGPS d'un projet (features/projects/project-ssdgps-list).
    'ssdgps': {
        'numero_ssdgps', 'nature_ssdgps', 'type_ssdgps', 'propriete_label', 'affaire_numero',
        'nbr_total_sessions', 'nbr_total_pieces', 'propriete_nom', 'propriete_id_titre',
        'propriete_id_requisition', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        'created_by_email', 'updated_by_email', 'deleted_by_email',
    },
    # Liste des PIÈCES d'un rapport SSDGPS (features/projects/piece-management-page).
    'pieces': {
        'ordre', 'type_piece_display', 'numero', 'portee_label', 'source_saisie', 'statut',
        'commentaire', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'created_by_email',
        'updated_by_email', 'deleted_by_email',
    },
}


class TableColumnsConfigView(APIView):
    """Configuration des COLONNES par défaut d'un tableau GÉNÉRIQUE, propre à l'opérateur.

    GET/PUT /api/auth/me/table-columns-config/<key>/  (key ∈ clés de `TABLE_COLUMN_FIELDS`)
    Corps PUT : liste ORDONNÉE `[{'field': '<colonne>', 'visible': true|false}, ..]` (l'ordre de la
    liste est l'ordre d'affichage). Champs validés contre l'allowlist de la clé ; doublons
    supprimés ; `visible` normalisé en booléen. Stocké dans `CustomUser.table_columns_configs[<key>]`.
    Miroir de `TableSortConfigView`."""
    permission_classes = [IsAuthenticated]

    def get(self, request, key):
        if key not in TABLE_COLUMN_FIELDS:
            return Response({'detail': f"Tableau inconnu : « {key} »."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response((request.user.table_columns_configs or {}).get(key, []),
                        status=status.HTTP_200_OK)

    def put(self, request, key):
        allowed = TABLE_COLUMN_FIELDS.get(key)
        if allowed is None:
            return Response({'detail': f"Tableau inconnu : « {key} »."},
                            status=status.HTTP_400_BAD_REQUEST)
        data = request.data
        if not isinstance(data, list):
            return Response({'detail': "Une liste de colonnes [{field, visible}] est attendue."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned, seen = [], set()
        for column in data:
            if not isinstance(column, dict):
                return Response({'detail': "Chaque colonne doit être un objet {field, visible}."},
                                status=status.HTTP_400_BAD_REQUEST)
            field = (column.get('field') or '').strip()
            if field not in allowed:
                return Response({'detail': f"Colonne invalide : « {field} »."},
                                status=status.HTTP_400_BAD_REQUEST)
            if field in seen:
                continue  # une colonne ne peut apparaître qu'une fois
            seen.add(field)
            cleaned.append({'field': field, 'visible': bool(column.get('visible', True))})
        configs = dict(request.user.table_columns_configs or {})
        configs[key] = cleaned
        request.user.table_columns_configs = configs
        request.user.save(update_fields=['table_columns_configs'])
        return Response(cleaned, status=status.HTTP_200_OK)


class TableColumnsConfigResetView(APIView):
    """Réinitialise la configuration de colonnes d'un tableau générique de l'opérateur avec la
    configuration SOURCE (compte super admin). POST .../<key>/reset/ → config appliquée, ou 400 si
    clé inconnue / aucune source disponible. Miroir de `TableSortConfigResetView`."""
    permission_classes = [IsAuthenticated]

    def post(self, request, key):
        import copy
        from .piece_defaults import superadmin_table_columns_config
        if key not in TABLE_COLUMN_FIELDS:
            return Response({'detail': f"Tableau inconnu : « {key} »."},
                            status=status.HTTP_400_BAD_REQUEST)
        source = superadmin_table_columns_config(key)
        if not source:
            return Response(
                {'detail': "Aucune configuration source disponible : le compte administrateur "
                           "n'a pas encore de colonnes configurées pour ce tableau."},
                status=status.HTTP_400_BAD_REQUEST)
        configs = dict(request.user.table_columns_configs or {})
        configs[key] = copy.deepcopy(source)
        request.user.table_columns_configs = configs
        request.user.save(update_fields=['table_columns_configs'])
        return Response(configs[key], status=status.HTTP_200_OK)
