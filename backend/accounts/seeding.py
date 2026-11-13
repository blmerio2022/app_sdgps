"""Amorçage IDEMPOTENT des données de référence de la plateforme SDGPS.

Point unique de vérité des données injectées **automatiquement à chaque réinitialisation de
la base** (signal `post_migrate`, cf. `accounts/apps.py`) et manuellement via la commande
`python manage.py seed_initial_data`.

Les données proviennent d'un **fichier JSON externe** :
- par défaut, le fichier embarqué `accounts/seed_data/initial_data.json` ;
- surchargeable via la variable d'environnement `SEED_DATA_FILE` (chemin absolu), typiquement
  monté en volume Docker en production → on modifie la liste sans reconstruire l'image.

Contenu (données de RÉFÉRENCE réelles, `is_test_data=False` pour les organisations) :
- Utilisateurs : 1 super-admin + N admins d'application (`ROLE_ADMIN_SYSTEME`). Le fichier porte
  les IDENTITÉS (email, nom, rôle) ; les **mots de passe restent en variables d'environnement**
  (jamais dans le fichier). Un champ `<clé>_env` est prioritaire sur la valeur littérale
  `<clé>` si la variable d'environnement est définie.
- Organisations prédéfinies.
- Organismes premier niveau (ANCFCC) + deuxième niveau (services).

Tout est idempotent (`get_or_create` / `filter().exists()`).
"""
import json
import random
import shutil
import string
from pathlib import Path

from decouple import config
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.dateparse import parse_datetime

from accounts.models import Organization

User = get_user_model()

# Répertoire des données embarquées.
SEED_DATA_DIR = Path(__file__).resolve().parent / 'seed_data'
# Fichier de données de référence par défaut (embarqué). Surchargé par SEED_DATA_FILE.
DEFAULT_SEED_FILE = SEED_DATA_DIR / 'initial_data.json'
# Fichier des données métier (projets → pièces). Surchargé par SEED_BUSINESS_FILE.
DEFAULT_BUSINESS_FILE = SEED_DATA_DIR / 'business_data.json'
# Binaires médias embarqués (images/fichiers de pièces), copiés vers MEDIA_ROOT au seed.
SEED_MEDIA_DIR = SEED_DATA_DIR / 'media'


def load_seed_data():
    """Charge les données d'initialisation depuis SEED_DATA_FILE, sinon le fichier par défaut."""
    path = config('SEED_DATA_FILE', default='') or str(DEFAULT_SEED_FILE)
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def load_business_data():
    """Charge le snapshot des données métier (SEED_BUSINESS_FILE, sinon fichier par défaut).

    Retourne un dict vide si aucun fichier n'est présent : le seed métier devient alors un
    no-op (rétro-compatible avec les déploiements sans données métier embarquées).
    """
    path = config('SEED_BUSINESS_FILE', default='') or str(DEFAULT_BUSINESS_FILE)
    if not Path(path).exists():
        return {}
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def _generate_password(length=16):
    """Génère un mot de passe aléatoire (utilisé si aucun mot de passe n'est fourni)."""
    alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
    return ''.join(random.choices(alphabet, k=length))


def _resolve(entry, key, default=''):
    """Résout un champ : variable d'environnement `<key>_env` si définie, sinon littéral `<key>`.

    Permet de garder les valeurs sensibles (mots de passe) hors du fichier tout en autorisant
    une surcharge par l'environnement des autres champs (ex. email de l'admin).
    """
    env_name = entry.get(f'{key}_env')
    if env_name:
        value = config(env_name, default='')
        if value:
            return value
    return entry.get(key, default)


def _seed_users(users, summary, log):
    """Crée les utilisateurs d'initialisation + leurs adhésions (idempotent par email).

    Flags supportés par entrée : `is_superuser`, `is_staff`, `platform_role`, `nom_societe`.
    Raccourci `role` optionnel : 'super_admin' (is_superuser) ou 'app_admin'
    (platform_role=ROLE_ADMIN_SYSTEME). Les `memberships` (liste de {organization_code, role,
    is_active}) rattachent l'utilisateur à des organisations existantes (créées au préalable).
    """
    from accounts.models import Membership

    for entry in users:
        email = _resolve(entry, 'email')
        if not email:
            continue

        # Mot de passe de RÉFÉRENCE : résolu via l'environnement (password_env) ou valeur
        # littérale. Fait autorité pour les comptes seedés (cf. synchronisation ci-dessous).
        resolved_pw = _resolve(entry, 'password')
        user = User.objects.filter(email=email).first()
        if user is None:
            # Généré aléatoirement si aucun mot de passe fourni.
            password = resolved_pw or _generate_password()
            extra = {}
            role = entry.get('role')
            if role == 'super_admin':
                extra.update(is_superuser=True, is_staff=True)
            elif role == 'app_admin':
                extra.update(platform_role='ROLE_ADMIN_SYSTEME')
            # Les flags explicites priment sur le raccourci `role`.
            if 'is_superuser' in entry:
                extra['is_superuser'] = entry['is_superuser']
            if 'is_staff' in entry:
                extra['is_staff'] = entry['is_staff']
            if entry.get('platform_role'):
                extra['platform_role'] = entry['platform_role']
            if entry.get('nom_societe'):
                extra['nom_societe'] = entry['nom_societe']

            user = User.objects.create_user(
                username=email,
                email=email,
                password=password,
                first_name=entry.get('first_name', ''),
                last_name=entry.get('last_name', ''),
                is_active=True,
                must_change_password=False,
                **extra,
            )
            summary['users_created'] += 1
            log(f"  Utilisateur créé : {email}")
        else:
            # Synchronisation du mot de passe : la variable d'env (password_env) fait autorité
            # pour les comptes de référence. Garantit des identifiants connus/déterministes à
            # chaque déploiement, même pour un compte créé lors d'un déploiement antérieur (le
            # seed ne faisait avant que de la création). Ne touche RIEN si aucun mot de passe
            # n'est fourni, ni si le mot de passe est déjà à jour (idempotent, pas d'écriture).
            if resolved_pw and not user.check_password(resolved_pw):
                user.set_password(resolved_pw)
                user.save(update_fields=['password'])
                summary['passwords_synced'] = summary.get('passwords_synced', 0) + 1
                log(f"  Mot de passe synchronisé : {email}")
            else:
                log(f"  Utilisateur déjà présent : {email}")

        # Adhésions (idempotentes) — appliquées même si l'utilisateur pré-existe.
        for m in entry.get('memberships', []):
            org = Organization.all_objects.filter(code=m['organization_code']).first()
            if org is None:
                log(f"    Adhésion ignorée : organisation {m['organization_code']} introuvable")
                continue
            Membership.objects.get_or_create(
                user=user, organization=org,
                defaults={
                    'role': m.get('role', 'ROLE_ORGANISATION_AGENT'),
                    'is_active': m.get('is_active', True),
                },
            )


def _seed_organizations(organizations, summary, log):
    """Crée les organisations depuis le fichier (idempotent par code).

    Les attributs présents dans le fichier sont conservés tels quels — notamment `is_test_data`
    et `is_deleted` — pour reproduire fidèlement l'état de référence. En leur absence, les
    valeurs par défaut du modèle s'appliquent (`is_test_data=False`).
    """
    for data in organizations:
        code = data['code']
        # all_objects : contourne le filtrage is_test_data du manager par défaut.
        defaults = {k: v for k, v in data.items() if k != 'code'}
        defaults['created_by'] = None
        _, created = Organization.all_objects.get_or_create(code=code, defaults=defaults)
        if created:
            summary['organizations_created'] += 1
        log(("  Créée" if created else "  Existante") + f" : organisation {code}")


def _seed_organismes(niveau1, niveau2, summary, log):
    """Crée les organismes N1 puis les N2 rattachés (via `niveau1_code`)."""
    # Import local : évite un couplage d'import au chargement du module accounts.
    from organismes.models import OrganismeNiveau1, OrganismeNiveau2

    by_code = {}
    for data in niveau1:
        n1, created = OrganismeNiveau1.objects.get_or_create(
            code=data['code'],
            defaults={'nom': data['nom'], 'sigle': data.get('sigle', '')})
        by_code[data['code']] = n1
        if created:
            summary['organismes_created'] += 1
        log(("  Créé" if created else "  Existant") + f" : organisme N1 {data['code']}")

    for data in niveau2:
        n1 = by_code.get(data['niveau1_code'])
        if n1 is None:
            # Le N1 référencé n'est pas dans le fichier : on le rattache s'il existe déjà en base.
            n1 = OrganismeNiveau1.objects.filter(code=data['niveau1_code']).first()
        if n1 is None:
            log(f"  Ignoré : organisme N2 {data['code']} (N1 {data['niveau1_code']} introuvable)")
            continue
        _, created = OrganismeNiveau2.objects.get_or_create(
            code=data['code'],
            defaults={'nom': data['nom'], 'ville': data.get('ville', ''), 'niveau1': n1})
        if created:
            summary['organismes_created'] += 1
        log(("  Créé" if created else "  Existant") + f" : organisme N2 {data['code']}")


def _copy_seed_media(media_files, log):
    """Copie les binaires médias embarqués vers MEDIA_ROOT (idempotent : ne réécrit pas).

    Retourne le nombre de fichiers effectivement copiés.
    """
    from django.conf import settings

    media_root = Path(settings.MEDIA_ROOT)
    copied = 0
    for rel in media_files:
        src = SEED_MEDIA_DIR / rel
        dst = media_root / rel
        if dst.exists():
            continue
        if not src.exists():
            log(f"    Média embarqué introuvable, ignoré : {rel}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    return copied


def _seed_business_data(data, summary, log):
    """Rejoue la cascade métier (Projet → … → PieceImage) + les métadonnées de champs.

    Idempotent : chaque entité est upsertée par sa PK (UUID conservée au dump ; PK entière
    pour PieceImage). Les FK naturelles sont ré-résolues ici : utilisateurs par email,
    organisation par `code`, organismes par `code`. Les horodatages d'audit du snapshot sont
    réappliqués APRÈS l'upsert (les champs `auto_now`/`auto_now_add` les écraseraient sinon),
    pour préserver l'ordre d'affichage des tableaux.
    """
    if not data:
        return

    from organismes.models import OrganismeNiveau1, OrganismeNiveau2
    from projects.models import Ssdgps
    from pieces.models import PieceFieldMeta

    user_id_by_email = {email: uid for uid, email in User.objects.values_list('id', 'email')}
    org_by_code = {o.code: o for o in Organization.all_objects.all()}
    o1_by_code = {o.code: o for o in OrganismeNiveau1.objects.all()}
    o2_by_code = {o.code: o for o in OrganismeNiveau2.objects.all()}

    def uid(email):
        return user_id_by_email.get(email) if email else None

    def audit_fields(row):
        """Champs d'audit/soft-delete communs de BaseModel (hors horodatages auto)."""
        return {
            'is_deleted': row.get('is_deleted', False),
            'deleted_at': parse_datetime(row['deleted_at']) if row.get('deleted_at') else None,
            'created_by_id': uid(row.get('created_by')),
            'updated_by_id': uid(row.get('updated_by')),
            'deleted_by_id': uid(row.get('deleted_by')),
        }

    def upsert(model, pk, defaults, counter, timestamps=None):
        """update_or_create par PK, puis réapplique les horodatages du snapshot si fournis.

        `timestamps` = dict des champs auto (created_at/updated_at) à figer via un UPDATE SQL
        direct (contourne auto_now/auto_now_add). Incrémente summary[counter] à la création.
        """
        obj, created = model.objects.update_or_create(pk=pk, defaults=defaults)
        if timestamps:
            stamps = {k: parse_datetime(v) for k, v in timestamps.items() if v}
            if stamps:
                model.objects.filter(pk=pk).update(**stamps)
        if created:
            summary[counter] = summary.get(counter, 0) + 1
        return obj

    # Le signal `autocreate_mono_session` crée une session n°1 à la création d'un SSDGPS
    # mono-session : on le neutralise le temps du seed pour rejouer À L'IDENTIQUE les sessions
    # du snapshot (avec leurs PK d'origine, indispensables aux FK Piece.session_id).
    from django.db.models.signals import post_save
    from projects.signals import autocreate_mono_session
    post_save.disconnect(autocreate_mono_session, sender=Ssdgps)
    try:
        _seed_business_rows(data, upsert, audit_fields, o1_by_code, o2_by_code, org_by_code, log)
    finally:
        post_save.connect(autocreate_mono_session, sender=Ssdgps)

    # --- Métadonnées de champs (clé naturelle type_piece + field_name) ---
    for row in data.get('piece_field_meta', []):
        _, created = PieceFieldMeta.objects.update_or_create(
            type_piece=row['type_piece'], field_name=row['field_name'],
            defaults={
                'description': row.get('description', ''), 'tooltip': row.get('tooltip', ''),
                'required': row.get('required', False),
            })
        if created:
            summary['piece_field_meta_created'] = summary.get('piece_field_meta_created', 0) + 1

    # --- Binaires médias ---
    summary['media_copied'] = _copy_seed_media(data.get('media_files', []), log)

    log(
        f"  Données métier : {summary.get('projets_created', 0)} projet(s), "
        f"{summary.get('proprietes_created', 0)} propriété(s), "
        f"{summary.get('affaires_created', 0)} affaire(s), "
        f"{summary.get('ssdgps_created', 0)} SSDGPS, "
        f"{summary.get('sessions_created', 0)} session(s), "
        f"{summary.get('pieces_created', 0)} pièce(s), "
        f"{summary.get('piece_images_created', 0)} image(s), "
        f"{summary.get('piece_field_meta_created', 0)} méta-champ(s), "
        f"{summary.get('media_copied', 0)} média(s) copié(s)."
    )


def _seed_business_rows(data, upsert, audit_fields, o1_by_code, o2_by_code, org_by_code, log):
    """Upsert la cascade Projet → … → PieceImage (signal mono-session déjà neutralisé).

    Chaque niveau ne seede QUE les entités dont le parent a effectivement été seedé (ensembles
    `seeded_*`) : si un projet est ignoré (organisation introuvable), toute sa descendance
    l'est aussi — jamais de FK orpheline, même avec un jeu de données de référence partiel.
    """
    from projects.models import Projet, Propriete, Affaire, Ssdgps, Session
    from pieces.models import Piece, PieceImage

    seeded_projets, seeded_proprietes, seeded_affaires = set(), set(), set()
    seeded_ssdgps, seeded_sessions, seeded_pieces = set(), set(), set()

    # --- Projets (org requise) ---
    for row in data.get('projets', []):
        org = org_by_code.get(row['organization_code'])
        if org is None:
            log(f"    Projet {row['code_projet']} ignoré : organisation {row['organization_code']} introuvable")
            continue
        # `code_projet` est unique. Sur une base fraîche, la migration de démo
        # `0003_seed_agent_projects` a pu créer un projet de MÊME code mais de PK aléatoire
        # (rattaché à une organisation de test). Le snapshot fait autorité : on supprime ce
        # doublon (sa cascade part avec) avant de recréer le projet à sa PK d'origine. Au
        # rejeu, la PK correspond déjà → aucune suppression (idempotent).
        Projet.objects.filter(code_projet=row['code_projet']).exclude(pk=row['id']).delete()
        upsert(Projet, row['id'], {
            'code_projet': row['code_projet'], 'nom_projet': row['nom_projet'],
            'description_projet': row.get('description_projet', ''), 'statut': row['statut'],
            'organization': org, **audit_fields(row),
        }, 'projets_created',
            {'created_at': row.get('created_at'), 'updated_at': row.get('updated_at')})
        seeded_projets.add(row['id'])

    # --- Propriétés ---
    for row in data.get('proprietes', []):
        if row['projet_id'] not in seeded_projets:
            continue
        upsert(Propriete, row['id'], {
            'projet_id': row['projet_id'], 'nom_propriete': row['nom_propriete'],
            'id_requisition': row.get('id_requisition', ''), 'id_titre': row.get('id_titre', ''),
            'organisme_niveau1': o1_by_code.get(row.get('organisme_niveau1_code')),
            'organisme_niveau2': o2_by_code.get(row.get('organisme_niveau2_code')),
            **audit_fields(row),
        }, 'proprietes_created',
            {'created_at': row.get('created_at'), 'updated_at': row.get('updated_at')})
        seeded_proprietes.add(row['id'])

    # --- Affaires ---
    for row in data.get('affaires', []):
        if row['propriete_id'] not in seeded_proprietes:
            continue
        upsert(Affaire, row['id'], {
            'propriete_id': row['propriete_id'], 'numero_sd_affaire': row['numero_sd_affaire'],
            'nature_procedure_affaire': row['nature_procedure_affaire'],
            'nature_affaire': row['nature_affaire'],
            'date_bornage': parse_datetime(row['date_bornage']) if row.get('date_bornage') else None,
            **audit_fields(row),
        }, 'affaires_created',
            {'created_at': row.get('created_at'), 'updated_at': row.get('updated_at')})
        seeded_affaires.add(row['id'])

    # --- SSDGPS ---
    for row in data.get('ssdgps', []):
        if row['affaire_id'] not in seeded_affaires:
            continue
        upsert(Ssdgps, row['id'], {
            'affaire_id': row['affaire_id'], 'nature_ssdgps': row['nature_ssdgps'],
            'numero_ssdgps': row['numero_ssdgps'], 'type_ssdgps': row['type_ssdgps'],
            **audit_fields(row),
        }, 'ssdgps_created',
            {'created_at': row.get('created_at'), 'updated_at': row.get('updated_at')})
        seeded_ssdgps.add(row['id'])

    # --- Sessions ---
    for row in data.get('sessions', []):
        if row['ssdgps_id'] not in seeded_ssdgps:
            continue
        upsert(Session, row['id'], {
            'ssdgps_id': row['ssdgps_id'], 'numero_session': row['numero_session'],
            'date_session': parse_datetime(row['date_session']) if row.get('date_session') else None,
            **audit_fields(row),
        }, 'sessions_created',
            {'created_at': row.get('created_at'), 'updated_at': row.get('updated_at')})
        seeded_sessions.add(row['id'])

    # --- Pièces ---
    for row in data.get('pieces', []):
        if row['ssdgps_id'] not in seeded_ssdgps:
            continue
        # La session est optionnelle : on ne la conserve que si elle a bien été seedée.
        session_id = row.get('session_id')
        if session_id and session_id not in seeded_sessions:
            session_id = None
        upsert(Piece, row['id'], {
            'ssdgps_id': row['ssdgps_id'], 'session_id': session_id,
            'type_piece': row['type_piece'], 'numero': row.get('numero'),
            'fichier': row.get('fichier') or '', 'taille_octets': row.get('taille_octets', 0),
            'ordre': row.get('ordre', 0), 'payload': row.get('payload', {}),
            'source_saisie': row['source_saisie'], 'statut': row.get('statut', 'brouillon'),
            'orientation': row.get('orientation', 'auto'),
            'versions_rapport': row.get('versions_rapport', 'both'),
            'commentaire': row.get('commentaire', ''), **audit_fields(row),
        }, 'pieces_created',
            {'created_at': row.get('created_at'), 'updated_at': row.get('updated_at')})
        seeded_pieces.add(row['id'])

    # --- Images de pièces (PK entière conservée) ---
    for row in data.get('piece_images', []):
        if row['piece_id'] not in seeded_pieces:
            continue
        upsert(PieceImage, row['id'], {
            'piece_id': row['piece_id'], 'fichier': row.get('fichier') or '',
            'apercu': row.get('apercu') or '', 'ordre': row.get('ordre', 0),
            'point_ref': row.get('point_ref', ''), 'format': row.get('format', ''),
            'taille_octets': row.get('taille_octets', 0), 'largeur': row.get('largeur', 0),
            'hauteur': row.get('hauteur', 0), 'mode_couleur': row.get('mode_couleur', ''),
            'compression': row.get('compression', ''),
            'date_creation': parse_datetime(row['date_creation']) if row.get('date_creation') else None,
            'date_modification': parse_datetime(row['date_modification']) if row.get('date_modification') else None,
        }, 'piece_images_created', {'created_at': row.get('created_at')})


@transaction.atomic
def run_seed(stdout=None, data=None, business_data=None):
    """Injecte l'ensemble des données d'initialisation (idempotent).

    `data` (optionnel) : dict de référence déjà chargé ; sinon lu via load_seed_data().
    `business_data` (optionnel) : dict métier déjà chargé ; sinon lu via load_business_data().
    Retourne le dict `summary` des compteurs de création (référence + métier).
    """
    if data is None:
        data = load_seed_data()
    if business_data is None:
        business_data = load_business_data()

    summary = {'users_created': 0, 'organizations_created': 0, 'organismes_created': 0}

    def log(message):
        if stdout is not None:
            stdout.write(message)

    log("Amorçage des données de référence SDGPS…")
    # Les organisations d'abord : les adhésions des utilisateurs les référencent par code.
    _seed_organizations(data.get('organizations', []), summary, log)
    _seed_users(data.get('users', []), summary, log)
    _seed_organismes(
        data.get('organismes_niveau1', []), data.get('organismes_niveau2', []), summary, log)
    # Les données métier référencent utilisateurs, organisations et organismes déjà seedés.
    _seed_business_data(business_data, summary, log)
    # Modèles de SDGPS de l'application (PDC, DDC, PLC, DLC) : données de RÉFÉRENCE,
    # dérivées du catalogue des pièces — jamais réécrits s'ils existent déjà.
    from projects.modeles import assurer_modeles_systeme
    summary['modeles_ssdgps_created'] = assurer_modeles_systeme()
    log(
        f"Terminé : {summary['users_created']} utilisateur(s), "
        f"{summary['organizations_created']} organisation(s), "
        f"{summary['organismes_created']} organisme(s) créés."
    )
    return summary
