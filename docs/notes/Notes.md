# Notes — Application SDGPS



## Sommaire

- [Notes — Application SDGPS](#notes-application-sdgps)
- [Taches a faire](#taches-a-faire)
- [Rôles de l'application](#rôles-de-lapplication)
  - [Définition des rôles](#définition-des-rôles)
  - [Hiérarchie](#hiérarchie)
  - [Correspondance backend/frontend](#correspondance-backendfrontend)
- [Comptes de test utilisateurs](#comptes-de-test-utilisateurs)
  - [Identifiants de connexion](#identifiants-de-connexion)
  - [Réinitialisation des données en cas de reset BDD](#réinitialisation-des-données-en-cas-de-reset-bdd)
- [Promptes importantes opencode](#promptes-importantes-opencode)
  - [Phase : configuration du depot git local + distant](#phase-configuration-du-depot-git-local-distant)
    - [Compte Github pour git + Github API token](#compte-github-pour-git-github-api-token)
    - [Configuration compte git par defaut pour le projet dans opencode](#configuration-compte-git-par-defaut-pour-le-projet-dans-opencode)
    - [Synchronisation depot local avec depot distant](#synchronisation-depot-local-avec-depot-distant)
    - [Structure des branches dans local et dans depot distant](#structure-des-branches-dans-local-et-dans-depot-distant)
    - [Creation des branches de fonctionnalite](#creation-des-branches-de-fonctionnalite)
    - [Prompte pour commit des modifs et synchronisation avec depot distant configure dans le projet](#prompte-pour-commit-des-modifs-et-synchronisation-avec-depot-distant-configure-dans-le-projet)
    - [promptes opencode + commandes pour controller le watcher.](#promptes-opencode-commandes-pour-controller-le-watcher)
  - [Teste de la version actuelle de l'app](#teste-de-la-version-actuelle-de-lapp)
    - [Identifiants des utilisateurs de tests](#identifiants-des-utilisateurs-de-tests)
    - [Prompte redemarrage serveurs backend + frontend](#prompte-redemarrage-serveurs-backend-frontend)
  - [Redaction du CPS de l'app](#redaction-du-cps-de-lapp)
    - [Prompt redaction CPS de l'app](#prompt-redaction-cps-de-lapp)
      - [Plan du CPS](#plan-du-cps)
      - [Acteurs et roles](#acteurs-et-roles)
  - [Phase : Developement de l'app](#phase-developement-de-lapp)
    - [Fonctionnalites Espace Admin : Gestion des organisations](#fonctionnalites-espace-admin-gestion-des-organisations)
      - [Prompte n1](#prompte-n1)
      - [Prompte n2](#prompte-n2)
      - [Prompte n3](#prompte-n3)
    - [Fonctionnalites Espace Admin : Gestion des utilisateurs](#fonctionnalites-espace-admin-gestion-des-utilisateurs)
      - [Plan des taches a faire](#plan-des-taches-a-faire)
      - [Prompte n1 : redaction plan de dev de la phase : Gestion des utilisateurs](#prompte-n1-redaction-plan-de-dev-de-la-phase-gestion-des-utilisateurs)
      - [Prompte n2 : implementation plan de dev de la phase : Gestion des utilisateurs](#prompte-n2-implementation-plan-de-dev-de-la-phase-gestion-des-utilisateurs)
      - [correction + refonte frontend tableau de la liste des utilisateurs.](#correction-refonte-frontend-tableau-de-la-liste-des-utilisateurs)
        - [Controle toutes les fonctionnalite de la page](#controle-toutes-les-fonctionnalite-de-la-page)
        - [Gestion affichage des roles des utilisateurs dans le tableau](#gestion-affichage-des-roles-des-utilisateurs-dans-le-tableau)
        - [Protection des superadmins (role : ROLE_SUPER_ADMIN)](#protection-des-superadmins-role-rolesuperadmin)
        - [Protection des admins systeme (Role : ROLE_ADMIN_SYSTEME)](#protection-des-admins-systeme-role-roleadminsysteme)
        - [Protection des admins systeme (Role : ROLE_ADMIN_ORGANISATION)](#protection-des-admins-systeme-role-roleadminorganisation)
        - [Recuperation des comptes supprimees](#recuperation-des-comptes-supprimees)
  - [Phase Developpement de l'app dans Claude Code.](#phase-developpement-de-lapp-dans-claude-code)
    - [Plan des taches a faire](#plan-des-taches-a-faire)
    - [maj du plan de developpement de l'app](#maj-du-plan-de-developpement-de-lapp)
    - [finalisation liste projets + projet explorer](#finalisation-liste-projets-projet-explorer)
    - [Implementation la saisie et l'import des donnees des pieces](#implementation-la-saisie-et-limport-des-donnees-des-pieces)
      - [Detail des pieces.](#detail-des-pieces)

# Taches a faire

  - Fonctionnalites manquantes dans l'app
    - Ajout cachet + signature sur toutes les pages du rapport.
    - Affectation pour chaque organisation d'un volume limite d'espace de stockage a ne pas depasser.
      - Lorsque le quota d'espace de stockage atteint. l'app affiche page de suppression des ssdgps mono-session/ssdgps-multi-session a supprimer. 
      - Affiche pour chaque element (ssdgps mono / sessions du ssdgps) la taille de l'espace de stockage restauree.
      - possibiliter de compression donnees des pieces du ssdgps-mono et/ou ssdgps-multi.
    - Preparation des sdgps multisession exemples
      - preparation des donnees des sessions des sdgps multisessions exemples : PLC/GPS - DLC/GPS
      - import donnees dans l'app + generation des sdgps des sessions + page de garde de tous les sdgps des sessions
    - Generation automatique canevas pdc/ddc/plc/dlc.
    - Geoportail pour afficher les donnees spatiales de chaque projet/propriete/affaire/ssdgps.



  - Divers:
    - Ajoute calcul nombre de lignes par page (dans le rapport PDF) pour les pieces contenant des tableaux de donnees.
    - Corrige lecture des noms des points contenant des espaces depuis html des fermetures des boucles.
    - Finaliser l'interface graphique UI/UX
      - redesigner pages consultation/modification des pieces. (fait)
      - redesigner les pages de creation de nouvelles pieces.
      - ajouter la vue en cartes de la liste des projets.
      - style affichage du menu de filtre dans page liste des pieces.
  


  - Plan de deployement : developement + tests + production
    - restructuration des fichiers .env des 4 environnements + docker-compose
      - desactivation admin django dans environnements railway
    - ajoute l'etape de monitoring de l'app avec outiles : Sentry + Prometheus + Grafana + UptimeRobot
    

 



Le tout afin de rendre l'interface beaucoup plus intuitive, pro, simple, visuellement attrayante et conforme aux bonnes pratiques UI/UX. Le tout egalement dans un style et design élégant, pro et conforme au design system de l'app. Utilise le plugin design pour un design et UI/UX  élégante, pro, intuitive, visuellement attrayante

- Fonctionnalites futures:
  - Ajouter une page de changelog + ajouter version dans l'app
  - Fonctionnalite gestion stockage des fichiers de l'app avec un fournisseur du service stockage.
  - inclure phase de resolution les problemes de securite
    - Resolution des problemes dans onglet Security and quality de Github


# Rôles de l'application

## Définition des rôles

| Rôle backend | Badge tableau | Affichage long | Niveau | Description |
|-------------|--------------|----------------|--------|-------------|
| `ROLE_SUPER_ADMIN` | Super Admin | Super Admin | Plateforme | Accès total à toutes les fonctionnalités. Gère les admins système, la configuration globale, les logs d'audit. Peut créer/modifier/supprimer tout utilisateur, y compris les admins système. Protégé contre l'auto-suppression et la suppression du dernier super admin actif. |
| `ROLE_ADMIN_SYSTEME` (plateforme) | Admin Système | Admin Système | Plateforme | Gère l'ensemble de la plateforme : utilisateurs, organisations, configuration système, rapports consolidés. Peut créer/modifier/supprimer tout utilisateur sauf les Super Admins. |
| `ROLE_ORGANISATION_ADMIN` (membership) | Admin Org | Admin Organisation | Organisation | Gère les agents de son organisation, valide les opérations sensibles, configure les paramètres spécifiques à l'organisation. Peut créer/modifier/supprimer uniquement les agents de son organisation. |
| `ROLE_ORGANISATION_AGENT` (membership) | Agent Org | Agent Organisation | Organisation | Profil opérationnel. Gère les projets, la saisie et l'import des données, la génération des rapports et documents. Ne peut pas créer/modifier/supprimer d'autres utilisateurs. |

## Hiérarchie

```
Super Admin > Admin Système > Admin Organisation > Agent Organisation
```

- Les rôles **Super Admin** et **Admin Système** sont des rôles **plateforme** (attachés à l'utilisateur, pas à une organisation).
- Les rôles **Admin Organisation** et **Agent Organisation** sont des rôles **d'organisation** (définis via Membership, un utilisateur peut avoir des rôles différents dans différentes organisations).

## Correspondance backend/frontend

| Backend (code) | Backend (affichage) | Frontend (badge) | Frontend (autre) |
|---------------|--------------------|-----------------|-----------------|
| `ROLE_SUPER_ADMIN` | `get_primary_role_display()` → Super Admin | user.role_display → Super Admin | getRoleLongName() → Super Admin |
| `ROLE_ADMIN_SYSTEME` | `get_primary_role_display()` → Admin Système | user.role_display → Admin Système | getRoleLongName() → Admin Système |
| `ROLE_ORGANISATION_ADMIN` | `get_primary_role_display()` → Admin Org \| Membership.get_role_display() → Admin Organisation | user.role_display → Admin Org | getRoleLongName() → Admin Organisation |
| `ROLE_ORGANISATION_AGENT` | `get_primary_role_display()` → Agent Org \| Membership.get_role_display() → Agent Organisation | user.role_display → Agent Org | getRoleLongName() → Agent Organisation |

> **Note :** Les membreships utilisent `Organization.ROLE_CHOICES` (Django `get_FOO_display()` → noms longs), tandis que `get_primary_role_display()` a son propre mapping (noms courts pour le badge tableau).


# Comptes de test utilisateurs

## Identifiants de connexion

| Nom complet | Email | Mot de passe | Rôle | Organisation |
|------------|-------|-------------|------|-------------|
| Abderrazzak Boulmane | boulmaneabderrazzak@gmail.com | Abderrazzak@1234 | Super Admin | — |
| Amine Benali | appadmin1@sdgps.ma | AppAdmin@2026 | App Admin | — |
| Sara El Amrani | appadmin2@sdgps.ma | AppAdmin@2026 | App Admin | — |
| Karim Tazi | orgadmin1@sdgps.ma | OrgAdmin@2026 | Admin Org | Cadastre Azilal |
| Nadia Fassi | orgadmin2@sdgps.ma | OrgAdmin@2026 | Admin Org | Cadastre Haouz |
| Hicham Bennani | orgadmin3@sdgps.ma | OrgAdmin@2026 | Admin Org | ITKANTOPO |
| Youssef Idrissi | agent1@sdgps.ma | Agent@2026 | Agent Org | Cadastre Azilal |
| Fatima Zahra | agent2@sdgps.ma | Agent@2026 | Agent Org | Cadastre Haouz |
| Omar Saidi | agent3@sdgps.ma | Agent@2026 | Agent Org | ITKANTOPO |

## Réinitialisation des données en cas de reset BDD

Si la base de données est réinitialisée (suppression du volume Docker ou `migrate --run-syncdb`), exécuter les commandes suivantes dans l'ordre :

```bash
# 1. Créer les organisations de démonstration (20 orgs PRIVATE + PUBLIC)
docker exec sdgps-backend python manage.py seed_demo_orgs

# 2. Créer les organisations de test (3 orgs) + les utilisateurs de test (11 comptes)
docker exec sdgps-backend python manage.py seed_test_users

# 3. Vérifier la création
docker exec sdgps-backend python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
print(f'Total utilisateurs: {User.objects.count()}')
for u in User.objects.all().order_by('-is_superuser', 'email'):
    print(f'  {u.email:35s} | {u.get_primary_role():25s}')
"
```

> **Note :** La commande `seed_test_users` est idempotente — elle ignore les comptes déjà existants. Les organisations créées sont marquées `is_test_data=True` et filtrées en production.

# Promptes importantes opencode
## Phase : configuration du depot git local + distant
### Compte Github pour git + Github API token

Configurer le compte suivant spécifiquement pour ce dépôt uniquement. Les infos du compte git sont les suivantes: 
email : "120096166+blmerio2022@users.noreply.github.com"
name : "blmerio2022"
Github token compte Blmerio2022: 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

### Configuration compte git par defaut pour le projet dans opencode

Est t il possible de configurer le compte git Blmerio2022 pour qu'il soit utilise toujours et par defaut dans ce projet. de telle sorte que lorsque opencode veut executer n'importe quelle commande git qui necessite le compte git, ce compte soit utiliser automatiquement sans ouverture de la fenetre git qui demande de selectionner le compte git



### Synchronisation depot local avec depot distant
synchronise ce depot local avec depot distant : https://github.com/blmerio2022/app_sdgps en utilisant ce compte

### Structure des branches dans local et dans depot distant
ajoute en local et dans depot distant une branche "develop" et l'activer par defaut en local et dans le depot distant. renomme la branche master local et distante en main si possible. de telle sorte que main locale suit origin/main et develop locale suit origin/develop.

### Creation des branches de fonctionnalite

Creer une branche pour la redaction du CPS de l'app (propose un nom parlant pour cette branche) et mettre cette branche comme active en local et dans le depot distant

### Prompte pour commit des modifs et synchronisation avec depot distant configure dans le projet

commit les changements dans le dépôt local et synchronise ces commites avec le dépôt distant global de l'app.

Quand le watcher a deja commiter maj le message du dernier commit dans le depot local et distant.
Squaser les derniers commits watcher en un seul commit avec un message pertinent.


### promptes opencode + commandes pour controller le watcher.

LANCER le watcher
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -File `"$pwd\.githooks\auto-save-watcher.ps1`""

VÉRIFIER s'il tourne
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -match 'auto-save-watcher' | Format-Table ProcessId, CommandLine -AutoSize -Wrap

ARRÊTER le watcher
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -match 'auto-save-watcher' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

VOIR L'HISTORIQUE des commits auto-save
git log --oneline --grep="wip: auto-save" --max-count=20


## Teste de la version actuelle de l'app

### Identifiants des utilisateurs de tests

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Super Admin | boulmaneabderrazzak@gmail.com | Abderrazzak@1234 |
| Utilisateur standard | abderrazzak.cadazilal@gmail.com | Test@1234 |

### Prompte redemarrage serveurs backend + frontend

force le redemarrage/relance des deux serveurs frontend et backend (vrai serveur backend via docker) en arriere plan (ne pas afficher de fenetres terminal dans windows) en utilisant l'environnement de development depuis la confi des environnements. relance backend sur port 8085 et frontend sur le port 4205. ne jamais stopper les autres process deja dans les autres ports par exemples : 8080/ 8081 ... ou bien 4200/4201 ...

relance le serveur frontend de l'environnemnt development sur port 4205.
relance egalement le serveur backend de l'environnemnt development sur port 8085.

## Redaction du CPS de l'app

### Prompt redaction CPS de l'app

l'objectif de ce cps est de decrire les differntes fonctionnalites qui seront developpees dans cette app, sans entrer en details dans l'implementation technique de ces fonctionnalites.

#### Plan du CPS

Redige le CPS de l'app suivant le plan ci-dessous. utilise speckit pour clarifier les points ambigues et manquantes.

Plan du CPS de l'app: 

0.Introduction et Contexte : Contexte ANCFCC + cabinets privés, périmètre

I. Objectifs du Projet

    1.1 Objectifs fonctionnels

    1.2 Objectifs techniques

II. Acteurs et Rôles
    

III. Description des Fonctionnalités


3.1 Espace Administration - ROLE_ADMIN_SYSTEME


3.2 Responsable Admin d'une organisation (ROLE_ORGANISATION_ADMIN)


3.3 Espace Agent d'une organisation (ROLE_ORGANISATION_AGENT)

3.4 Fonctionnalités Innovantes


IV. Spécifications Techniques


4.1 Stack technologique obligatoire

4.2 Architecture applicative

4.3 Sécurité

4.4 Exigences non fonctionnelles

VI. Contraintes et Consignes Importantes

6.1 Contraintes de développement

6.2 Consignes de sécurité

VII. Glossaire : Définitions des termes métier


#### Acteurs et roles

L'application distingue quatre profils utilisateurs, chacun disposant de droits stricts.

Administrateur de l'app (ROLE_ADMIN_SYSTEME):

	Configuration globale, gestion des utilisateurs,
	paramétrage global de l'app, supervision des organisations, rapports consolidés.

Responsable Admin d'une organisation (ROLE_ORGANISATION_ADMIN):

	Gestion des agents de son organisation, validation
	des opérations sensibles, rapports de l'organisation,
	Responsable du parametrage specifique a l'organisation.


Agent d'une organisation (ROLE_ORGANISATION_AGENT):

    Gestion et configuration des porojets
    Gestion et configuration des rapports
    Gestion et configuration des pieces
    Saisie et import des donnees
    Generation des rapports

## Phase : Developement de l'app

### Fonctionnalites Espace Admin : Gestion des organisations

#### Prompte n1

Je veux maintenant, ajouter les fonctionnalites suivantes dans le tableau de la liste des organisations dans la page "/admin/organisations/liste" : 

dans le footer du tableau a gauche les outils de filtres (afficher toutes les organisations, Afficher uniquement les organisations selectionnees, filtrer par champs) et dans la partie droite les outils de paginations.

Le tout en s'inspirant tres grandement du tableau deja present dans le code et qui contient toutes ces fonctionnalites (tableau de la "Liste des tranches des grilles tarifaires des corridors" dans la page "/admin/devises-pays" onglet "Grilles Tarifaires") du projet dont le code source est dans le dossier suivant "D:\BOULMANE\SMAHAN BOULMANE\PROJET-ATLAS-OKAN-TRANSFERT" . Le tout dans un style et design élégant, pro et conforme au design System de l'app.

#### Prompte n2

le style des outils de filtrage et de pagination du tableau de la liste des organisations est tres moche. corrige le style en utilisant un style élégant, pro et conforme au design System de l'app.

#### Prompte n3

corrige les points suivants : 
    - la ligne des noms des colonnes du tableau de la liste des organisations doit etre figee lors du scroll vertical.
    - L'espace reserve a l'affichage des lignes du tableau doit etre le plus grand possible, le footer du tableau doit etre figee en bas de la page, pour accordee le plus d'espace possible pour l'affiche des donnees du tableau.
    - au chargement de la page "/admin/organisations/liste" par defaut seulement 5 organisations qui doivent s'afficher dans le tableau.
    - L'entete de la colonne action ne reste pas figee lors du scroll vertical.surtout lorsque le nombre d'elements par page selectionne est > nombre elements qu'une page peut afficher sans activer scroll vertical (dans mon ecran = 5 lignes)
    - la colonne type doit afficher seulement "Administration" pour les organisations de type "Entité Publique / Administration" et "Entreprise" pour les organisations de type "Cabinet Privé / Entreprise".
    - Maintenant lorsque une ligne est selectionnee ou bien survoler la colonne action est non incluse dans cette selection/survole.
    - Ajouter les options de la colonne actions : voir details, modifier, supprimer dans la fenetre contextuel du clique droit sur une ligne.
    - je ne comprend pas pourquoi le style de la fenetre modifier une organisation est cassee
    - corrige le style de la fenetre "Organiser les colonnes" en utilisant un style élégant, pro et conforme au design System de l'app.
    - lorsque je survole le nom d'une colonne le background devient transparent. corrige ce probleme
    - toujours lorsque le scroll vertical est active et que je scroll verticalement puis apres survole du nom d'une colonne la ligne en dessous s'affiche car le fond de cette colonne est transparent. corrige ce probleme.

### Fonctionnalites Espace Admin : Gestion des utilisateurs

#### Plan des taches a faire

  - Affiner les controles pour les comptes superadmin
    - controle de securite du minimum de 2 admin system.
      - bloquer changement de role pour admin systeme si nbr admin system <= 2. (fait)
      - inactiver les bouttons activer/desactiver et supprimer pour admin systeme si nbr admin system <= 2. (fait)
      - synchroniser toggle activer/desactiver dans colonne action et celui du modal edit (fait)
  - Implementer la suppression definitive des comptes. 



#### Prompte n1 : redaction plan de dev de la phase : Gestion des utilisateurs

L'objectif maintenant est de developper la fonctionnalite de gestion des utilisateurs de l'app.

La plateforme distingue trois profils utilisateurs, chacun disposant de droits et responsabilités spécifiques :

    Administrateur de l'application (ROLE_ADMIN_SYSTEME)
    Profil de plus haut niveau. Gère l'ensemble de la plateforme : configuration globale, gestion des utilisateurs et organisations, paramétrage système, supervision des activités et consultation des rapports consolidés.
    L'administrateur de l'application (ROLE_ADMIN_SYSTEME) peut creer/modifier/supprimer n'importe quel utilisateur : les Administrateur de l'application (ROLE_ADMIN_SYSTEME), les Responsables Admin d'une organisation (ROLE_ORGANISATION_ADMIN) et les Agents d'une organisation (ROLE_ORGANISATION_AGENT). il peut egalement reinitialiser le mdp de n'importe quel autre utilisateur y compris ceux des Administrateurs de l'application (ROLE_ADMIN_SYSTEME)

    Responsable Admin d'une organisation (ROLE_ORGANISATION_ADMIN)
    Profil de gestion au niveau d'une organisation (service ANCFCC ou cabinet privé). Gère les agents de son organisation, valide les opérations sensibles, supervise les projets et configure les paramètres spécifiques à son organisation.
    Le responsable Admin d'une organisation (ROLE_ORGANISATION_ADMIN) peut creer/modifier/supprimer uniquement les agents de son organisation (ROLE_ORGANISATION_AGENT). il peut egalement reinitialiser le mdp de n'importe quel agent de son organisation (ROLE_ORGANISATION_AGENT).

    Agent d'une organisation (ROLE_ORGANISATION_AGENT)
    Profil opérationnel. Assure la gestion courante des projets, la saisie et l'import des données, la génération des rapports et documents, et la configuration des pièces.
    L'agent d'une organisation ne peut pas creer/modifier/supprimer aucun utilisateur de l'app. 

Fonctionnalités à implémenter (par priorité)
1. Liste des Utilisateurs (page admin)
Backend : GET/DELETE /api/v1/users/ — lister, filtrer (par rôle, statut, organisation), désactiver/supprimer des utilisateurs
Frontend : UserListComponent — tableau type organisations (checkbox, sticky actions, tri, pagination, filtre par rôle/statut/org)
Valeur : indispensable pour F05 (CPS)
2. Détail / Édition d'un Utilisateur
Backend : GET/PUT/PATCH /api/v1/users/<id>/ — modifier infos, rôle, statut, reset MDP forcé
Frontend : UserDetailComponent — formulaire avec sections (infos personnelles, rôle, organisation, statut, actions MDP)
Valeur : nécessaire pour F05, F12
3. Gestion des Rôles & Permissions (F06)
Backend : endpoint GET /api/v1/roles/ + PUT /api/v1/users/<id>/role/ — modifier le rôle d'un utilisateur dans une organisation
Frontend : RolesPermissionsComponent — visualisation des rôles avec leurs permissions, assignation par utilisateur
Valeur : contrôle d'accès fin
4. Membres d'une Organisation (vue org)
Backend : déjà partiellement avec OrganizationMembersView et AddMemberView
Frontend : OrganizationMembersComponent — intégré dans la vue détail d'organisation, lister/ajouter/retirer des membres
Valeur : gestion quotidienne des équipes
5. Journal des Connexions
Backend : endpoint GET /api/v1/users/audit/ (dernières connexions, IP, date)
Frontend : section dans l'utilisateur ou page dédiée
Valeur : traçabilité sécurité (complémentaire aux logs d'audit déjà prévus)
L'architecture à suivre serait cohérente avec organization-list : module dédié features/admin/users/, service core/services/user.service.ts, routes sous /admin/utilisateurs/* (déjà configurées dans le menu mais pas dans le routeur).

L'objectif est de rediger le plan de dev de l'app dans docs/plans/PLAN_DEV.md. ce plan doit contenir une phase pour toutes ces fonctionnalites de gestion des utilisateurs. utilise speckit pour clarifier les points ambigues et manquantes.

pour question 1 : utilise CustomUser.is_superuser = True (pas lié à une org) pour ROLE_ADMIN_SYSTEME et les profils ROLE_ORGANISATION_ADMIN, ROLE_ORGANISATION_AGENT pour les valeurs de Membership.role au lieu des valeurs :  OWNER, ADMIN, MANAGER, USER. pour question n2 : cette fonctionnalite est reportée à une phase ultérieure. pour question n3 : option A.

pour question n1 :  option (A) L'admin définit un mot de passe temporaire + option "forcer changement au premier login". pour question n2 : on garde les deux l'admin peut supprimer un utilisateur ( fait un soft-delete (comme pour les organisations avec is_deleted)) et encore garder l'option de Désactivation : un utilisateur peut etre desactive  via is_active. pour la question n3 : pour l'instant garder seulement les superuser presents, ne pas créer dès cette phase d'autres utilisateurs ROLE_ADMIN_SYSTEME.

Ajouter au repo local et distant la branche main pour production et develop comme point de depart des fonctionnalites nouvelles dans l'app. a chaque phase une nouvelle branche de fonctionnalite sera cree et une fois testee et validee sera fusionnee dans develop. Ajouter ces instructions au plsn de dev. Configurer le compte suivant spécifiquement pour ce dépôt uniquement. Les infos du compte git sont les suivantes: 
email : "120096166+blmerio2022@users.noreply.github.com"
name : "blmerio2022"

#### Prompte n2 : implementation plan de dev de la phase : Gestion des utilisateurs

passons maintenant a l'implementation de la phase Gestion des Utilisateurs.

#### correction + refonte frontend tableau de la liste des utilisateurs.

##### Controle toutes les fonctionnalite de la page

Maintenant je veux corriger les points suivantes dans le tableau de la liste des utilisateurs :
  - correction outil "deplacer vers le haut des lignes selectionnees" dans la barre des outils du tabelau. cette outil ne fonctionne pas.
  -	restyler/redesigner le boutton close (boutton en haut a droite de la fenetre) des modales en le mettant dans un style élégant, pro et conforme au design System de l'app.
  - mettre les boutons dans la colonne action du tableau dans une seule ligne pas de retour a la ligne entre les bouttons. le tout dans un style et design élégant, pro et conforme au design System de l'app.
  - restyler/redesigner le toggle activer/desactiver un utilisateur et son modale en les mettant dans un style élégant, pro et conforme au design System de l'app.
  -  restyler/redesigner le boutton confirmer de la modale de Désactiver/Activer le Compte en le mettant dans un style élégant, pro et conforme au design System de l'app.
  - Corrige l'action d'activation/desactivation d'un compte utilisateur dans l'app. l'app affiche un message d'erreur toast "Erreur lors du changement de statut" lors de la desactivation de tout compte.
  - restyler/redesigner le modale "Réinitialiser le Mot de Passe" en la mettant dans un style élégant, pro et conforme au design System de l'app. ajouter dans le modale la section pour generer/regenerer le mdp. 

  - Maintenant je veux que tu me propose une meilleur manière plus intuitive pour bloquer le changement de rôle  des admins systemes que la methode du message "Rôle bloqué. Impossible de changer le rôle : cela laisserait moins de deux administrateurs système actifs." afficher dans le toast.
  - 


##### Gestion affichage des roles des utilisateurs dans le tableau

  - Ajouter dans la bdd de l'app 1 autre compte superadmin + 2 compte avec role admin de l'app + 3 comptes avec role admin d'organisation ( 3 comptes pour 3 organisations differentes) + 3 comptes avec role d'agent dans organisation ( 3 comptes pour 3 organisations differentes).
  - Ajoute une section dans docs/notes/Notes.md apres section "Taches a faire" qui va contenir les infos de connexion de tous les utilisateurs actuels dans l'app  (utilisateurs importants pour les tests de l'app). sous forme d'un tableau : nom complet / email / mdp / role / organisation. ajoute les instructions pour reajoutees ces donnees dans la bdd en cas de son reinitialisation.
  
  - Quelles sont les contextes dans la page de la liste des utilisateurs dans lesquelles les noms des roles s'affichent.
  - Uniformiser en utilisant "Admin Org" au lieu de "Responsable Admin".
  - Renomme le role "Agent" en "Agent Org".
  - A ton avis est ce une bonne chose de changer les noms frontend de ces roles pour des noms plus explicites ou bien garder ces memes noms en frontend.

  - Ajoute une section dans docs/notes/Notes.md apres section "Taches a faire" qui va contenir tous les roles definies dans l'app avec leurs noms backend et frontend et une explication de chaque role.




##### Protection des superadmins (role : ROLE_SUPER_ADMIN)

Quelles sont les protectioms implementees actuellement dans l'app pour le role : ROLE_SUPER_ADMIN.

Protection contre : 
- auto-desactivation / auto-suppresion / 
- auto-changement de rôle / auto-reset du MDP
- Dernier super admin actif
- is_superuser read-only
- 

Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
  - Protege les dits utilisateurs de l'auto-desactivation (possibilite qu'un superadmin desactiver lui meme) via backend et frontend : via toggle, menu contextuel et check-box statut dans le modal editer.

Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
  - Protege les dits utilisateurs de l'auto-suppresion (possibilite qu'un superadmin supprime lui meme) . la protection doit etre effectuee au niveau du backend et frontend. le frontend via boutton supprimer, option supprimer du menu contextuel et suppression individuel ou groupee via boutton supprimer de la barre des outils du tableau de la liste des utilisateurs.
  - Propose une bonne maniere plus intuitive pour proteger les utilisateurs dont role est ROLE_SUPER_ADMIN de la suppression soit  individuel soit groupee via le boutton supprimer de la barre des outils du tableau de la liste des utilisateurs.
  - le boutton supprimer la selection dans la barre des outils du tableau n'est pas desactiver quand le superadmin connecte est inclus dans la selection. le message du tooltip doit etre concis toute en etre claire, montrant a l'utilisateur quoi faire.
  - Propose une bonne maniere de marquer (faire resortir) le compte actuellement connecte dans le tableau des utilisateurs le tout dans un style élégant, pro et conforme au design System de l'app.

Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
  - Protege les dits utilisateurs de l'auto-changement de rôle (possibilite qu'un superadmin change son role lui meme). la protection doit etre effectuee au niveau du backend et frontend.

Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
    - Protege les dits utilisateurs de l'auto-reset du MDP (possibilite qu'un superadmin de resetter son MDP lui meme). la protection doit etre effectuee au niveau du backend et frontend.

Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
  - Protege les dits utilisateurs de l'auto-edition (possibilite qu'un superadmin edite ces infos lui meme). la protection doit etre effectuee au niveau du backend et frontend. ===> ce n'est pas une bonne maniere de faire. voici pourquoi : 
      - Aucun risque de sécurité : changer son prénom/nom n'est pas une escalade de privilèges
    - Expérience utilisateur dégradée : un super admin ne pourrait pas corriger une faute dans son propre nom sans appeler quelqu'un d'autre
    - Incohérent avec la réalité : GitHub, GitLab, tous les dashboards pros permettent l'édition de son propre profil
    
Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
- Protege les dits utilisateurs contre ce risque "Dernier super admin actif" (possibilite qu'un superadmin supprime/desactive/change les infos d'un autre superadmin qui implique que l'app sera en situation d'un seul et dernier superadmin actif non supprime). la protection doit etre effectuee au niveau du backend et frontend.





##### Protection des admins systeme (Role : ROLE_ADMIN_SYSTEME)

Pour les "Admin Systeme"  (role = ROLE_ADMIN_SYSTEME) est ce n'est pas une bonne maniere de ne pas afficher les comptes des superadmins dans le tableau de la liste des utilisateurs.
Que pense tu de refactoriser le nom du ROLE_ADMIN_SYSTEME en ROLE_ADMIN_SYSTEME pour conformite avec le nom frontend du role.

Quelles sont les protections implementees actuellement dans l'app pour le role : ROLE_ADMIN_SYSTEME.

Quelles protections propose tu a jouter pour le rôle ROLE_ADMIN_SYSTEME, en suivant les bonnes manieres de dev.



Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_SUPER_ADMIN :
  - Corrige le champs Organisation dans les modals lecture/modification des utilisateurs dont role est ROLE_ADMIN_SYSTEME de la meme facon que pour les utilisateurs dont role est ROLE_SUPER_ADMIN.
  - restyler/redesigner l'icon + texte "Non applicable (rôle plateforme)" en la mettant dans un style élégant, pro et conforme au design System de l'app.
  - Est ce une bonne chose que les utilisateurs admin systeme peuvent creer d'autres utilisateurs de meme role (role ROLE_ADMIN_SYSTEME).
  - Est ce une bonne chose que les utilisateurs admin systeme peuvent supprimer d'autres utilisateurs de meme role (role ROLE_ADMIN_SYSTEME).
  - Dans le modal de confirmation de la suppression d'un admin Systeme affiche un message pour protection du deux dernier comptes admin systeme actifs et non pas pour la protection pair pair. a votre avis quelle est la meilleur manière de faire désactiver définitivement le boutton supprimer ou bien l'activer et afficher le modale avec un message claire puis desactiver le boutton "Confirmer" du modale.
  - le bouton supprimer dans la barre des outils du tableau est actif quand la sélection comprend un autre admin systeme. comment faire a votre avis pour ajoute ce controle d'auto suppression / de suppression pair via le boutton de la barre des outils du tableau. tout en affichant des messages claires explicatif a l'utilisateur.
  - A votre avis est ce que ce n'est pas une bonne manière que tous les messages des avertissement et d'information relatives a la suppression d'un ou des utilisateurs "Admin Systeme" par un autre utilisateur  "Admin Systeme" soient regroupees dans le modal de suppression (boutton confirmer du modale desactive pour bloquer la suppression), mais en gardant seulement les avertissement relatif au conntrole suivant : "les Admin System ne peuvent etre supprimee que par des superadmin", les autres controles sont a mon avis inclus dans ce controle precedant. quelle est votre avis et quelle est la bonne maniere de faire.





Protection contre : 
- auto-desactivation / auto-suppresion / 
- auto-changement de rôle / auto-reset du MDP
- Modifier/supprimer un autre App Admin
- Empêcher suppression/désactivation du dernier App Admin
- is_superuser read-only
- 


Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_ADMIN_SYSTEME :
  - Protege les dits utilisateurs de l'auto-desactivation (possibilite qu'un utilisateur avec role ROLE_ADMIN_SYSTEME de desactiver lui meme) via backend et frontend.
Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_ADMIN_SYSTEME :
  - Protege les dits utilisateurs de l'auto-suppresion (possibilite que a un utilisateur avec role ROLE_ADMIN_SYSTEME de supprime lui meme) . la protection doit etre effectuee au niveau du backend et frontend. le frontend via boutton supprimer, option supprimer du menu contextuel et suppression individuel ou groupee via boutton supprimer de la barre des outils du tableau de la liste des utilisateurs.
Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_ADMIN_SYSTEME :
  - Protege les dits utilisateurs de l'auto-changement de rôle (possibilite que a un utilisateur avec role ROLE_ADMIN_SYSTEME de change son role lui meme). la protection doit etre effectuee au niveau du backend et frontend.
Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_ADMIN_SYSTEME :
    - Protege les dits utilisateurs de l'auto-reset du MDP (possibilite que a un utilisateur avec role ROLE_ADMIN_SYSTEME de resetter son MDP lui meme). la protection doit etre effectuee au niveau du backend et frontend.
Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_ADMIN_SYSTEME :
  - Protege les dits utilisateurs de l'auto-edition (possibilite  que a un utilisateur avec role ROLE_ADMIN_SYSTEME d'edite ces infos lui meme). la protection doit etre effectuee au niveau du backend et frontend.

Maintenant corrige les points suivants pour les utilisateurs dont role est ROLE_ADMIN_SYSTEME :
  - Protege les dits utilisateurs contre ce risque "deux derniers admin systeme actifs" (que a un utilisateur avec role ROLE_ADMIN_SYSTEME de supprimer/desactiver/changer les infos d'un autre "App admin" qui implique que l'app sera en situation d'un seul et dernier "App admin" actif non supprime). la protection doit etre effectuee au niveau du backend et frontend.



##### Protection des admins systeme (Role : ROLE_ADMIN_ORGANISATION)

   corrige : 
    - seulement Super Admin / Admin Système peut créer une org. 
    - seulement Super Admin / Admin Système peut créer des admins des orgs.
    - seulement Super Admin / Admin Système peuvent lire les membres de TOUTES les orgs




##### Recuperation des comptes supprimees

Quelle solution propose tu pour ajouter la possibiliter de recuperer les comptes utilisateurs supprimes.



## Phase Developpement de l'app dans Claude Code.

### Plan des taches a faire
  - maj du plan de developpement de l'app (fait)
  - finalisation liste projets + projet explorer:
    - generation des donnees tests pour agents agent1/2/3@sdgps.ma  (fait)
    - separation elements actifs de ceux supprimes dans l'explorateur (Propriété → Affaire → SSDGPS → Session).  (fait)
    - correction quelques points dans l'explorateur (Projet → Propriété → Affaire → SSDGPS → Session). (fait)
  - implementation de la section : 6.5 Saisie & import des données des pièces et suivantes
  - implementation de la Phase 6 — Pièces & génération de rapports PDF SSDGPS


  - Harmoniser les methodes d'ajout des donnees tests : 
    - Migrations automatiques (RunPython) — exécutées par migrate
    - Commandes de gestion manuelles : python manage.py seed_test_users / python manage.py seed_demo_orgs
    - Fixture JSON (loaddata) : python manage.py loaddata backup_real_orgs.json (25 organisations)


  - Validation choix du moteur de rendu de generation des fichiers pdf.


### maj du plan de developpement de l'app


mon app est destinee a generer des rapports pdf contenant plusieurs pieces. un rapport de sous dossier GPS est un rapport contenant plusiuers pieces relatives au post-traitement bureau des observations GPS relatif au dit sd gps. 
Un ssd gps est toujours un sous sous dossier d'un sous dossier d'affaire. qui lui meme sous dossier d'une propriete.
chaque ssdgps est caracterise par les champs suivants : 
- nature_ssdgps : une valeur parmi les suivants
  - PDC/GPS : Projet de densification cadastrale par GPS
  - DDC/GPS : Dossier de densification cadastrale par GPS
  - PLC/GPS : Projet de leve cadastral par GPS
  - DLC/GPS : Dossier de leve cadastral par GPS
- numero_ssdgps : indique le numero d'ordre du sous sous dossier gps dans son sd mere (sous dossier d'affaire)
- type_ssdgps : une valeur parmi les suivants
  - mono-session : indique que le ssd gps contient une seule session des observations gps
  - multi-session : indique que le ssd gps contient plusieurs sessions des observations gps
- id_affaire : id de l'affaire a laquelle le ssd gps appartient.

chaque sd d'affaire est caracterise par les champs suivants : 
  - numero sd affaire : numero d'ordre du sd d'affaire dans le dossier mere (dossier de la propriete)
  - nature_procedure_affaire : une valeure parmi les suivantes :
    - IFF: Immatriculation Fonciere Faculatative
    - IFE : Immatriculation Fonciere d'Ensemble
    - IFR : Immatriculation Fonciere de Remembrement
    - PS_FORET : Procedure speciale Foret
    - PS_COLLECTIF : Procedure speciale Collectif
    - PS_EXPROPRIATION : Procedure expropriation
    - AS : Affaires subsequentes
  - nature_affaire : une valeure parmi les suivantes qui depend de la nature_procedure_affaire :
      - Pour IFF :
        - BI : bornage d'immatriculation
        - BC : bornage complementaire
      - Pour IFE :
        - IFE : Immatriculation Fonciere d'Ensemble
      - Pour IFR :
        - IFR : Immatriculation Fonciere de Remembrement
      - Pour PS_FORET/PS_COLLECTIF/PS_EXPROPRIATION :
        - RB : Recollement de bornage.
      - Pour AS:
        - MEC : Mise en Concordance
        - MT : Morcellement
        - FS : Fusion
        - MT-FS : Morcellement-Fusion
        - LOT : Lotissement
        - COP : Copropriete
    - date_bornage : en generale c'est la date de l'operation bornage ou de recollement de bornage de l'affaire en question. cette date est definie comme suit :
      - Pour IFF/AS : C'est la date de l'operation de bornage.
      - Pour IFE/IFR : non definie pour ces deux procedures.
      - Pour PS_FORET/PS_COLLECTIF/PS_EXPROPRIATION : c'est la date de l'operation de recollement de bornage.
    - id_propriete : id de la propriete a laquelle cette affaire appartient.

chaque propriete est caracterisee par les champs suivants : 
  - nom_propriete/propriete_dite : nom de la propriete
  - id_requisition : id de la requisition d'immatriculation (id pour la propriete pendant la phase de preparation pour l'immatriculation) sous cette forme : R + numero_d'ordre de la requisition + "/" + indice_requisition (soit un numero d'ordre entre 1 et 1000. soit une ou deux lettres en majuscules).
  - id_titre : id du titre foncier de la propriete apres immatriculation sous cette forme : T + numero_d'ordre du titre + "/" + indice_titre (soit un numero d'ordre entre 1 et 1000. soit une ou deux lettres en majuscules).
  - id_projet: id du projet a lequel appartient cette propriete

chaque projet dans l'app est caracterisee par les champs suivants : 
  - nom_projet : nom du projet
  - description_projet : description du projet 
  - autres champs utiles et interessants que vous me proposez. 

La liste des pieces qui peuvent etre incluses dans un rapport du ssdgps sont les suivantes, ainsi que la source possible des donnees de cette piece sont donnees dans le tableau suivant : 
| Noms des Pièces | Natures SDGPS | Sources des données |
|---|---|---|
| Page de Garde SDGPS | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | UI dans l'app pour choisir et définir l'ordre des pièces du rapport |
| Rapport de Consultation | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | Images uploadées dans l'app |
| Liste des Points Anciens | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | Fichier CSV/Excel ou saisie directe dans l'app |
| Canevas de Contrôle de Stabilité des Points Anciens | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | Images uploadées dans l'app |
| Canevas de Densification Cadastrale | PDC/GPS; DDC/GPS | Images uploadées dans l'app |
| Canevas de Levé Cadastral | PLC/GPS; DLC/GPS | Images uploadées dans l'app |
| Photos des points anciens | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | Images uploadées dans l'app + CSV/Excel/saisie directe |
| Photos des points nouveaux | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | Images uploadées dans l'app + CSV/Excel/saisie directe |
| Fiche Technique des Récepteurs | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport des Observations Brutes | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport du traitement des lignes de base | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport des fermetures des Boucles | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport de la détermination libre | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport de la détermination N°1 | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport de la détermination N°2 | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport de la détermination N°3 | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport des déterminations Intermédiaires | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport de la détermination définitive | DDC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |
| Rapport de contrôle | PDC/GPS; DDC/GPS; PLC/GPS; DLC/GPS | CSV/Excel/saisie directe dans l'app |

Des exemples de rapports PDF des quatres natures des SSDGPS sont fournies en pieces jointes.

D'apres cette description de l'app. adapte le plan de developpement de l'app dans docs/plans/PLAN_DEV.md en y ajoutant les phases et etapes necessaires pour implementer les fonctionnalites manquantes dans l'app. n'hesiter pas a me poser les questions necessaires pour clarifier les points ambigues ou manquants.


implementons la Phase 5 — Domaine métier & saisie des données. n'hesiter pas a me poser les questions necessaires pour clarifier les points ambigues ou manquants. et en meme temps maj le plan de dev dans docs/plans/PLAN_DEV.md avec ces clarifications.



### finalisation liste projets + projet explorer

corrige le style et design des pages de la fonctionnalite menu Projets → liste + explorateur (Propriété → Affaire → SSDGPS → Session) en mettant le tout dans un style élégant, pro et conforme au design System de l'app.

ajoute les outils suivantes : 
  - outils de selection : selectionner tout, deselectionner tout, inverser la selection, deplacer la selection en haut.
  - afficher les stats : total, filtres, selectionnes dans le titre de la page.
  - formatter la boite de dialoguer organiser les colonnes pour qu'elle soient identique a cette de la page de la liste des utilisateurs.
  - Ajouter l'option supprimes dans le menu tous les statut avec possibilite de recuperer les projets supprimes.
  - Ajouter les autres outils manquantes dans la barre des outils du tableau.
  - ajouter les outils de filtrage dans la partie gauche du footer du tableau.
  - ajouter les options de tri et de filtrage sur les colonnes du tableau.
  - ajouter le menu contextuel du clique droit sur les colonnnes et les lignes du tableau.
  - ajouter les outiles importantes pour la navigation dans l'explorateur (Propriété → Affaire → SSDGPS → Session)
le tout dans un style élégant, pro et conforme au design System de l'app.


Corrige les points suivants:
  - lorsque aucun projet n'est present dans le tableau liste des projets. l'icon projet doit etre centree avec le texte dans le centre de la zone des lignes dans le tableau
  - outils pour afficher et restaurer les elements supprimes dans l'explorateur (Propriété → Affaire → SSDGPS → Session).
  - ajouter des donnees de tests seed de projets et pour les  entitees  : Propriété → Affaire → SSDGPS → Session, de tellesorte que si la bdd est reinitialisee ces donnees sont ajoutees dans la bdd apres reinitialisation. ces donnees de tests doivent etre ignorees si deja presents dans la bdd.

Les donnees de tests doivent etres ajoutees pour les utilisateurs suivantes : agent1@sdgps.ma / agent2@sdgps.ma / agent3@sdgps.ma. ces donnees doivent contenir entre 3-4 projets, 3-4 proprietees par projets, 3-4 affaires par propriete. 3-4 ssdgps par affaire, 1-4 sessions par ssdgps. ne rien tester juste ajoute ces donnees de tests dans la bdd et faire en sorte que ces donnees s'ajoute dans la bdd apres une reinitialisation de la bdd.

Que pense tu de mettre les elements actifs de l'explorateur (Propriété → Affaire → SSDGPS → Session) dans un onglet par defaut et ceux supprimes dans un autre onglet pour une meilleure UI/UX. si tu a une meilleur idee plus intuitive pour separer les elements actifs de ceux supprimes propose la pour moi.


Que pense tu si les donnees des entitees dans l'explorateur (Propriété → Affaire → SSDGPS → Session) s'affichent sous format de tableaux (les donnees de chaque entite dans un tableau) avec toutes les outils necessaires et indisponsables pour interagir avec le tableau (memes outiles que dans le tableau de la liste des utilisateurs et des projets), toute en gardant la structure explorateur.

Que pense tu des modifs suivantes : 
  - ajouter la vue "carte" pour la liste des projets.
  - ajouter les infos suivantes dans la vue carte et tableau pour la liste des projets : nbr_total_proprietes, nbr_total_affaires, nbr_total_ssdgps, nbr_total_sessions.
  - ajouter les infos suivantes dans la vue carte et tableau pour de la liste des proprietes : id_titre, id_requisition, propriete_dite, nbr_total_affaires, nbr_total_ssdgps, nbr_total_sessions.
  - faire de meme pour les autres niveaux : affaires, ssdgps, sessions
Le tout dans un style élégant, pro et conforme au design System de l'app.

Que pense tu des modifs suivantes :
  - l'outil remonter la selection en haut ne fonctionne pas.
  - ajouter les deux onglets actifs et corbeille pour la liste des projets.
  - mettre la zone de recherche d'un projet dans le meme ligne que le menu de la liste des status.
  - ajouter les champs : created_by, created_at, updated_at, uptaded_by, is_deleted, deleted_at, deleted_by; pour tous les entitees de l'explorateur (Projets → Propriété → Affaire → SSDGPS → Session).
  - l'icon de corbeille/icon de l'entitee en cours doit etre centree dans le tableau en cas du tableau vide.
Le tout dans un style élégant, pro et conforme au design System de l'app.



### Implementation la saisie et l'import des donnees des pieces

Que pense tu des modifs suivantes :  
  - modifie la facon d'ajouter les pieces d'un sdgps en utilisant une page dediee au lieu d'un modal. la page d'ajout des pieces d'un sdgps doit avoir en plus de la vue carte une vue tableau. les deux doivent contenir tous les outiles de tableau : outiles deja presentes dans les tableaux de l'explorateur (Projet → Propriété → Affaire → SSDGPS → Session). En plus de ces outiles, les lignes des pieces doivent les fonctionnalites suivantes : 
  - chaque ligne doit contenir les outils pour changer l'ordre de la piece dans le rapport du sdgps (premier, precedant, suivant, dernier) s'inspire des outiles dans le modale de gestion des colonnes dans les vues tableaux. En plus de ces outiles ajouter l'option de reorganiser par glisser deposer.
  - Pour chaque piece l'utilisateur doit choisir parmi les sources de donnees disponibles pour cette piece. puis en fonction de la source de donnees, une fenetre s'ouvre pour charger ou saisir les donnees de cette piece.
  - Ajouter la possibilite de soft-delete des pieces + leur restauration exactement comme dans les autres vues carte/tableau precedantes de l'explorateur (Projet → Propriété → Affaire → SSDGPS → Session).
  -  Si le sdgps est multi-sessions l'app doit permetre a l'utilisateur d'indiquer pour chaque piece si la piece en cours est commune a toutes les sessions ou bien specifique a la session en cours.
  - Pour les pieces dont le mapping colonnes → champs est obligatoire, ajoute toutes les outiles necessaires pour faire ce mappage de la facon la plus generique, intuitive, pro, et élégante possible.
Le tout dans un style élégant, pro et conforme au design System de l'app.


Corrige les points suivants : 
  - corrige le style et design des bouttons : premier, precedant, suivant, dernier dans le tableau de la liste des pieces du rapport.
  - ajoute la description des colonnes du tableau de la liste des pieces dans la fenetre organiser les colonnes.
  - corriger la possibilite de retourner dans l'entite session/ssdgps quand on est dans l'entite pieces.
  - que pense tu de toujours mettre la page de garde en tout debut de la liste des pieces. ou bien ne pas le faire car c'est evident.
  - Ajouter la possibilite de voir/modifier une piece dans la liste des pieces.
  - ajouter la possibilite de choisir si une piece est de niveau ssdgps ou bien de niveau session lors de l'ajout/modification.
  - ajouter une mention quelque part (choisit le bon endroit) pour ajouter dans la liste des pieces si le ssdgps en cours est monosession/multission, si multisesssion le numero + date de la session en cours.
Le tout dans un style élégant, pro et conforme au design System de l'app.


Corrige les points suivants : 
  - centrer verticalement les bouttons : premier, precedant, suivant, dernier dans le tableau de la liste des pieces du rapport.
  - toujours la description des colonnes du tableau de la liste des pieces dans la fenetre organiser les colonnes est non ajoutee.
  - ajouter le nombre de pieces dans l'entitee : ssdgps et session.
  - Ajouter la possibilite de voir (lecture sans modification dans la fenetre modale) des donnees d'une piece dans la liste des pieces .
  - ajouter la possibilite - lors de l'ajout/modification d'une piece - de modifier le niveau d'une piece ("niveau ssdgps": piece commune a toutes les sessions. c.a.d meme contenu pour toutes les sessions. ou bien "niveau session": piece differente d'une session a une autre. c.a.d contenu de la piece different d'une session a une autre).
  - ajouter la possibilite - lors de l'ajout/modification d'une piece - de modifier le numero d'ordre de la piece dans le ssdgps.
Le tout dans un style élégant, pro et conforme au design System de l'app.


Que pense tu des modifs suivantes : 
  - Ajoute dans le fil d'arian de navigation dans l'explorateur Propriété → Affaire → SSDGPS → Session, ajoute le niveau session entre ssdgps et pieces. si le ssdgps est monosession ce niveau session ne doit pas apparaitre en aucun endroit ni dans le fil d'arian, ni dans les pieces l'utilisateur doit automatiquement etre switcher vers la page d'ajout des pieces et leurs donnees sans passer par l'entitee session.
Le tout dans un style élégant, pro et conforme au design System de l'app.


Corrige le probleme suivant : quand l'app est inactive un certain temps. si l'utilisateur clique apres n'importe ou, l'app se deconnecte et redirige vers la page de login.

Corrige le probleme suivant : 
  - corrige le nom du ssdgps dans le fil d'arian en "SSDGPS Ni - NATURE_SSDGPS - Mono/Multi" avec i est le numero d'ordre du ssdgps dans le sd d'affaire.
  - Pourquoi l'avant dernier element du fil d'arian (id du ssdgps pour les ssdgps monosessions et id_session_en_cours si le ssdgps est multisession) est non cliquable.




#### Detail des pieces.
