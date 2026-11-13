"""
Modèles de SDGPS et assistant de création.

Ce que ces tests verrouillent :
- les 4 modèles de l'application (PDC, DDC, PLC, DLC) existent et reprennent les pièces
  que le catalogue rattache à leur nature ; leur amorçage est idempotent ;
- la validation d'une liste de pièces (type inconnu, non applicable, doublon, numéro) ;
- la visibilité : modèles système pour tous, modèles personnels pour leur seul
  propriétaire ; seule l'administration de l'application crée ou modifie un modèle système ;
- l'assistant crée la chaîne projet → propriété → affaire → SDGPS en UNE transaction
  (rien n'est écrit si un maillon échoue), réutilise l'existant, respecte la portée RBAC ;
- la liste de contrôle (`plan`) et la validation groupée des pièces.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from organismes.models import OrganismeNiveau1, OrganismeNiveau2
from pieces.catalog import PIECE_CATALOG
from pieces.models import Piece
from projects.modeles import (
    assurer_modeles_systeme, normaliser_pieces, pieces_par_defaut, plan_du_ssdgps,
)
from projects.models import Affaire, ModeleSsdgps, Projet, Propriete, Session, Ssdgps

User = get_user_model()
URL_MODELES = '/api/v1/modeles-ssdgps/'
URL_ASSISTANT = '/api/v1/ssdgps/assistant/'


def _user(email, org=None, role='ROLE_ORGANISATION_AGENT', **extra):
    user = User.objects.create_user(username=email, email=email, password='Passw0rd!')
    for k, v in extra.items():
        setattr(user, k, v)
    user.save()
    if org is not None:
        Membership.objects.create(user=user, organization=org, role=role)
    return user


class BaseTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-A', name='Org A')
        self.autre_org = Organization.objects.create(code='ORG-B', name='Org B')
        self.agent = _user('agent@sdgps.ma', self.org)
        self.intrus = _user('intrus@sdgps.ma', self.autre_org)
        self.admin_app = _user('sys@sdgps.ma', platform_role='ROLE_ADMIN_SYSTEME')
        self.n1 = OrganismeNiveau1.objects.create(code='N1', nom='ANCFCC')
        self.n2 = OrganismeNiveau2.objects.create(code='N2', nom='Service', niveau1=self.n1)
        self.client.force_authenticate(self.agent)

    def modele_systeme(self, code='PDC'):
        return ModeleSsdgps.objects.get(portee='systeme', code_systeme=code)

    def corps(self, **surcharges):
        corps = {
            'projet': {'nouveau': {'nom_projet': 'Projet assistant', 'code_projet': 'P-AS-1'}},
            'propriete': {'nouveau': {
                'nom_propriete': 'Bled X', 'id_titre': 'T1234/A',
                'organisme_niveau1': str(self.n1.pk), 'organisme_niveau2': str(self.n2.pk)}},
            'affaire': {'nouveau': {
                'numero_sd_affaire': 1, 'nature_procedure_affaire': 'IFF',
                'nature_affaire': 'BI', 'date_bornage': '2024-03-01T09:00:00Z'}},
            'ssdgps': {'nature_ssdgps': 'PDC/GPS', 'type_ssdgps': 'mono-session'},
            'modele': str(self.modele_systeme().pk),
        }
        corps.update(surcharges)
        return corps


class ModelesSystemeTests(BaseTest):
    def test_quatre_modeles_systeme_un_par_nature(self):
        natures = set(ModeleSsdgps.objects.filter(portee='systeme')
                      .values_list('nature_ssdgps', flat=True))
        self.assertEqual(natures, {'PDC/GPS', 'DDC/GPS', 'PLC/GPS', 'DLC/GPS'})

    def test_les_pieces_suivent_le_catalogue_de_la_nature(self):
        types = [p['type_piece'] for p in self.modele_systeme('DLC').pieces]
        self.assertIn('RDI', types)          # propre au DLC
        self.assertNotIn('RDN', types)       # non applicable au DLC
        self.assertNotIn('PGSDGPS', types)   # générée par le rapport
        self.assertEqual(types, [p['type_piece'] for p in pieces_par_defaut('DLC/GPS')])

    def test_un_type_repetable_recoit_le_numero_1(self):
        rdn = [p for p in self.modele_systeme('PDC').pieces if p['type_piece'] == 'RDN']
        self.assertEqual(rdn, [{'type_piece': 'RDN', 'numero': 1, 'obligatoire': True}])

    def test_amorcage_idempotent_et_respecte_les_modifications(self):
        modele = self.modele_systeme()
        modele.nom = 'Renommé par l’admin'
        modele.save()
        self.assertEqual(assurer_modeles_systeme(), 0)
        modele.refresh_from_db()
        self.assertEqual(modele.nom, 'Renommé par l’admin')
        self.assertEqual(ModeleSsdgps.objects.filter(portee='systeme').count(), 4)


class NormalisationTests(TestCase):
    def test_type_inconnu(self):
        with self.assertRaisesMessage(ValidationError, 'inconnu'):
            normaliser_pieces([{'type_piece': 'XXX'}], 'PDC/GPS')

    def test_type_non_applicable_a_la_nature(self):
        with self.assertRaisesMessage(ValidationError, 'ne s'):
            normaliser_pieces([{'type_piece': 'RDI'}], 'PDC/GPS')

    def test_type_genere_refuse(self):
        with self.assertRaisesMessage(ValidationError, 'générée par le rapport'):
            normaliser_pieces([{'type_piece': 'PGSDGPS'}], 'PDC/GPS')

    def test_doublon_refuse(self):
        with self.assertRaisesMessage(ValidationError, 'deux fois'):
            normaliser_pieces([{'type_piece': 'LPA'}, {'type_piece': 'LPA'}], 'PDC/GPS')

    def test_repetable_sans_numero_refuse(self):
        with self.assertRaisesMessage(ValidationError, 'numéro'):
            normaliser_pieces([{'type_piece': 'RDN'}], 'PDC/GPS')

    def test_numero_ignore_pour_un_type_non_repetable(self):
        propres = normaliser_pieces(
            [{'type_piece': 'LPA', 'numero': 4}, {'type_piece': 'RDN', 'numero': '2'}],
            'PDC/GPS')
        self.assertEqual(propres[0]['numero'], None)
        self.assertEqual(propres[1]['numero'], 2)

    def test_liste_vide_refusee(self):
        with self.assertRaises(ValidationError):
            normaliser_pieces([], 'PDC/GPS')


class ApiModelesTests(BaseTest):
    def creer_perso(self, user=None, **extra):
        self.client.force_authenticate(user or self.agent)
        corps = {'nom': 'Mon PDC léger', 'nature_ssdgps': 'PDC/GPS',
                 'pieces': [{'type_piece': 'LPA'}, {'type_piece': 'RDN', 'numero': 1}], **extra}
        return self.client.post(URL_MODELES, corps, format='json')

    def test_creation_d_un_modele_personnel(self):
        resp = self.creer_perso()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['portee'], 'personnel')
        self.assertEqual(resp.data['nb_pieces'], 2)
        self.assertTrue(resp.data['modifiable'])
        modele = ModeleSsdgps.objects.get(pk=resp.data['id'])
        self.assertEqual(modele.proprietaire, self.agent)

    def test_pieces_invalides_400(self):
        resp = self.creer_perso(pieces=[{'type_piece': 'RDI'}])
        self.assertEqual(resp.status_code, 400)
        self.assertIn('pieces', resp.data)

    def test_un_agent_ne_cree_pas_de_modele_systeme(self):
        resp = self.creer_perso(portee='systeme')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('portee', resp.data)

    def test_l_admin_app_cree_un_modele_systeme(self):
        resp = self.creer_perso(user=self.admin_app, portee='systeme')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(ModeleSsdgps.objects.get(pk=resp.data['id']).proprietaire)

    def test_liste_systeme_plus_personnels_de_l_appelant_seulement(self):
        self.creer_perso()
        self.creer_perso(user=self.intrus, nom='Modèle de l’intrus')
        self.client.force_authenticate(self.agent)
        noms = [m['nom'] for m in self.client.get(URL_MODELES).data]
        self.assertIn('Mon PDC léger', noms)
        self.assertNotIn('Modèle de l’intrus', noms)
        self.assertEqual(sum(1 for m in self.client.get(URL_MODELES).data
                             if m['portee'] == 'systeme'), 4)

    def test_filtre_par_nature(self):
        data = self.client.get(URL_MODELES, {'nature': 'DLC/GPS'}).data
        self.assertTrue(data)
        self.assertTrue(all(m['nature_ssdgps'] == 'DLC/GPS' for m in data))

    def test_un_agent_ne_modifie_pas_un_modele_systeme(self):
        modele = self.modele_systeme()
        resp = self.client.patch(f'{URL_MODELES}{modele.pk}/', {'nom': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(self.client.get(f'{URL_MODELES}{modele.pk}/').data['modifiable'])

    def test_l_admin_app_modifie_un_modele_systeme(self):
        self.client.force_authenticate(self.admin_app)
        modele = self.modele_systeme()
        resp = self.client.patch(f'{URL_MODELES}{modele.pk}/', {'nom': 'PDC révisé'},
                                 format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_le_modele_personnel_d_autrui_est_invisible(self):
        resp = self.creer_perso(user=self.intrus)
        self.client.force_authenticate(self.agent)
        url = f"{URL_MODELES}{resp.data['id']}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)

    def test_suppression_logique_par_le_proprietaire(self):
        resp = self.creer_perso()
        url = f"{URL_MODELES}{resp.data['id']}/"
        self.assertEqual(self.client.delete(url).status_code, 204)
        modele = ModeleSsdgps.objects.get(pk=resp.data['id'])
        self.assertTrue(modele.is_deleted)
        self.assertEqual(modele.deleted_by, self.agent)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_dupliquer_un_modele_systeme_donne_un_modele_personnel(self):
        source = self.modele_systeme()
        resp = self.client.post(f'{URL_MODELES}{source.pk}/dupliquer/', {'nom': 'Ma copie'},
                                format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['portee'], 'personnel')
        self.assertEqual(resp.data['nom'], 'Ma copie')
        self.assertEqual(len(resp.data['pieces']), len(source.pieces))

    def test_libelle_de_la_rdn_porte_son_numero(self):
        resp = self.creer_perso()
        rdn = [p for p in resp.data['pieces_detail'] if p['type_piece'] == 'RDN'][0]
        self.assertIn('N°1', rdn['nom'])


class AssistantTests(BaseTest):
    def test_cree_toute_la_chaine_en_une_requete(self):
        resp = self.client.post(URL_ASSISTANT, self.corps(), format='json')

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['crees'], ['projet', 'propriete', 'affaire', 'ssdgps'])
        ssdgps = Ssdgps.objects.get(pk=resp.data['ssdgps']['id'])
        projet = ssdgps.affaire.propriete.projet
        self.assertEqual(projet.organization, self.org)       # forcée sur l'org de l'agent
        self.assertEqual(projet.created_by, self.agent)
        self.assertEqual(ssdgps.numero_ssdgps, 1)              # numéro attribué
        self.assertEqual(ssdgps.modele, self.modele_systeme())
        self.assertEqual(ssdgps.pieces_prevues, self.modele_systeme().pieces)
        self.assertEqual(ssdgps.sessions.count(), 1)           # session implicite (mono)
        self.assertEqual(resp.data['plan']['total'], len(ssdgps.pieces_prevues))
        self.assertEqual(resp.data['plan']['importees'], 0)
        self.assertFalse(resp.data['plan']['pret'])

    def test_rien_n_est_ecrit_si_un_maillon_echoue(self):
        corps = self.corps(affaire={'nouveau': {'numero_sd_affaire': 1}})  # incomplète

        resp = self.client.post(URL_ASSISTANT, corps, format='json')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('affaire', resp.data)
        self.assertFalse(Projet.objects.filter(code_projet='P-AS-1').exists())
        self.assertFalse(Propriete.objects.filter(id_titre='T1234/A').exists())

    def test_erreur_de_propriete_rangee_sous_sa_cle(self):
        corps = self.corps(propriete={'nouveau': {'nom_propriete': 'Sans identifiant',
                                                  'organisme_niveau1': str(self.n1.pk),
                                                  'organisme_niveau2': str(self.n2.pk)}})
        resp = self.client.post(URL_ASSISTANT, corps, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('propriete', resp.data)

    def test_reutilise_projet_propriete_affaire_existants(self):
        projet = Projet.objects.create(nom_projet='P', code_projet='P-EX', organization=self.org,
                                       created_by=self.agent)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T1/A', projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=3, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2024, 1, 1, tzinfo=dt_timezone.utc), propriete=propriete)
        Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=4, affaire=affaire)

        resp = self.client.post(URL_ASSISTANT, self.corps(
            projet={'id': str(projet.pk)}, propriete={'id': str(propriete.pk)},
            affaire={'id': str(affaire.pk)}), format='json')

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['crees'], ['ssdgps'])
        self.assertEqual(resp.data['ssdgps']['numero_ssdgps'], 5)   # suivant le dernier

    def test_propriete_d_un_autre_projet_refusee(self):
        projet = Projet.objects.create(nom_projet='P', code_projet='P-EX', organization=self.org)
        autre = Projet.objects.create(nom_projet='Q', code_projet='Q-EX', organization=self.org)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T1/A', projet=autre)
        resp = self.client.post(URL_ASSISTANT, self.corps(
            projet={'id': str(projet.pk)}, propriete={'id': str(propriete.pk)}), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('propriete', resp.data)

    def test_projet_d_une_autre_organisation_inaccessible(self):
        projet = Projet.objects.create(nom_projet='P', code_projet='P-B',
                                       organization=self.autre_org)
        resp = self.client.post(URL_ASSISTANT, self.corps(projet={'id': str(projet.pk)}),
                                format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('projet', resp.data)
        self.assertFalse(Propriete.objects.filter(projet=projet).exists())

    def test_modele_de_nature_differente_refuse(self):
        resp = self.client.post(URL_ASSISTANT, self.corps(
            modele=str(self.modele_systeme('DLC').pk)), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('modele', resp.data)

    def test_la_nature_est_deduite_du_modele(self):
        resp = self.client.post(URL_ASSISTANT, self.corps(
            ssdgps={'type_ssdgps': 'mono-session'},
            modele=str(self.modele_systeme('DLC').pk)), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['ssdgps']['nature_ssdgps'], 'DLC/GPS')

    def test_modele_personnel_d_autrui_refuse(self):
        modele = ModeleSsdgps.objects.create(
            nom='Privé', nature_ssdgps='PDC/GPS', portee='personnel', proprietaire=self.intrus,
            pieces=[{'type_piece': 'LPA', 'numero': None, 'obligatoire': True}])
        resp = self.client.post(URL_ASSISTANT, self.corps(modele=str(modele.pk)), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('modele', resp.data)

    def test_multi_session_cree_ses_sessions(self):
        resp = self.client.post(URL_ASSISTANT, self.corps(
            ssdgps={'nature_ssdgps': 'PDC/GPS', 'type_ssdgps': 'multi-session'},
            nb_sessions=3), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        ssdgps = Ssdgps.objects.get(pk=resp.data['ssdgps']['id'])
        self.assertEqual(sorted(ssdgps.sessions.values_list('numero_session', flat=True)),
                         [1, 2, 3])

    def test_nombre_de_sessions_invalide(self):
        resp = self.client.post(URL_ASSISTANT, self.corps(
            ssdgps={'nature_ssdgps': 'PDC/GPS', 'type_ssdgps': 'multi-session'},
            nb_sessions=0), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('nb_sessions', resp.data)
        self.assertFalse(Projet.objects.filter(code_projet='P-AS-1').exists())

    def test_niveau_manquant(self):
        corps = self.corps()
        del corps['affaire']
        resp = self.client.post(URL_ASSISTANT, corps, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('affaire', resp.data)

    def test_non_authentifie(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(URL_ASSISTANT, self.corps(), format='json')
                         .status_code, 401)


class PlanEtValidationTests(BaseTest):
    def setUp(self):
        super().setUp()
        resp = self.client.post(URL_ASSISTANT, self.corps(), format='json')
        self.ssdgps = Ssdgps.objects.get(pk=resp.data['ssdgps']['id'])

    def piece(self, type_piece, statut='brouillon', numero=None, **extra):
        return Piece.objects.create(
            ssdgps=self.ssdgps, type_piece=type_piece, numero=numero, statut=statut,
            source_saisie='manuel', payload={'rows': [{'nom_point': 'B1'}]}, **extra)

    def test_etats_de_la_liste_de_controle(self):
        self.piece('LPA', 'valide')
        self.piece('ROB', 'brouillon')
        self.piece('RDN', 'rejete', numero=1)

        plan = self.client.get(f'/api/v1/ssdgps/{self.ssdgps.pk}/plan/').data

        etats = {i['type_piece']: i['etat'] for i in plan['items']}
        self.assertEqual(etats['LPA'], 'valide')
        self.assertEqual(etats['ROB'], 'brouillon')
        self.assertEqual(etats['RDN'], 'rejete')
        self.assertEqual(etats['RDC'], 'a_importer')
        self.assertEqual(plan['importees'], 3)
        self.assertEqual(plan['validees'], 1)
        self.assertFalse(plan['pret'])

    def test_pret_quand_toutes_les_obligatoires_sont_validees(self):
        self.ssdgps.pieces_prevues = [
            {'type_piece': 'LPA', 'numero': None, 'obligatoire': True},
            {'type_piece': 'FTR', 'numero': None, 'obligatoire': False},
        ]
        self.ssdgps.save()
        self.piece('LPA', 'valide')
        self.assertTrue(plan_du_ssdgps(self.ssdgps)['pret'])
        # …mais une pièce hors modèle encore en brouillon empêche d'être prêt.
        self.piece('ROB', 'brouillon')
        plan = plan_du_ssdgps(self.ssdgps)
        self.assertFalse(plan['pret'])
        self.assertEqual([p['type_piece'] for p in plan['hors_modele']], ['ROB'])

    def test_valider_pieces_valide_tout_ce_qui_peut_l_etre(self):
        self.piece('LPA')
        self.piece('ROB')
        # PPA sans photo : la règle unitaire refuse sa validation.
        ppa = self.piece('PPA')

        resp = self.client.post(f'/api/v1/ssdgps/{self.ssdgps.pk}/valider-pieces/', {},
                                format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['validees'], 2)
        self.assertEqual([e['id'] for e in resp.data['echecs']], [str(ppa.pk)])
        self.assertIn('photo', resp.data['echecs'][0]['message'])
        ppa.refresh_from_db()
        self.assertEqual(ppa.statut, 'brouillon')
        lpa = Piece.objects.get(ssdgps=self.ssdgps, type_piece='LPA')
        self.assertEqual(lpa.updated_by, self.agent)

    def test_valider_pieces_restreint_aux_ids(self):
        lpa = self.piece('LPA')
        rob = self.piece('ROB')
        resp = self.client.post(f'/api/v1/ssdgps/{self.ssdgps.pk}/valider-pieces/',
                                {'ids': [str(lpa.pk)]}, format='json')
        self.assertEqual(resp.data['validees'], 1)
        rob.refresh_from_db()
        self.assertEqual(rob.statut, 'brouillon')

    def test_valider_pieces_refuse_sur_dossier_fige(self):
        self.piece('LPA')
        self.ssdgps.statut = Ssdgps.Statut.SOUMIS
        self.ssdgps.save()
        resp = self.client.post(f'/api/v1/ssdgps/{self.ssdgps.pk}/valider-pieces/', {},
                                format='json')
        self.assertEqual(resp.status_code, 403)

    def test_plan_inaccessible_hors_portee(self):
        self.client.force_authenticate(self.intrus)
        self.assertEqual(
            self.client.get(f'/api/v1/ssdgps/{self.ssdgps.pk}/plan/').status_code, 404)
        self.assertEqual(self.client.post(
            f'/api/v1/ssdgps/{self.ssdgps.pk}/valider-pieces/', {}, format='json'
        ).status_code, 404)

    def test_appliquer_un_modele_a_un_dossier_existant(self):
        modele = ModeleSsdgps.objects.create(
            nom='Court', nature_ssdgps='PDC/GPS', portee='personnel', proprietaire=self.agent,
            pieces=[{'type_piece': 'LPA', 'numero': None, 'obligatoire': True}])
        resp = self.client.post(f'/api/v1/ssdgps/{self.ssdgps.pk}/appliquer-modele/',
                                {'modele': str(modele.pk)}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['total'], 1)
        self.ssdgps.refresh_from_db()
        self.assertEqual(self.ssdgps.modele, modele)

    def test_appliquer_un_modele_d_une_autre_nature_refuse(self):
        resp = self.client.post(f'/api/v1/ssdgps/{self.ssdgps.pk}/appliquer-modele/',
                                {'modele': str(self.modele_systeme('DLC').pk)}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_modifier_le_modele_ne_change_pas_le_dossier(self):
        modele = self.modele_systeme()
        avant = list(self.ssdgps.pieces_prevues)
        modele.pieces = [{'type_piece': 'LPA', 'numero': None, 'obligatoire': True}]
        modele.save()
        self.ssdgps.refresh_from_db()
        self.assertEqual(self.ssdgps.pieces_prevues, avant)

    def test_enregistrer_un_dossier_comme_modele(self):
        self.piece('LPA', 'valide')
        self.piece('RDN', numero=1)
        self.piece('RDN', numero=2)
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='PGSDGPS', source_saisie='ui')

        resp = self.client.post(f'{URL_MODELES}depuis-ssdgps/',
                                {'ssdgps': str(self.ssdgps.pk), 'nom': 'Depuis dossier'},
                                format='json')

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual([(p['type_piece'], p['numero']) for p in resp.data['pieces']],
                         [('LPA', None), ('RDN', 1), ('RDN', 2)])
        self.assertEqual(resp.data['portee'], 'personnel')

    def test_enregistrer_un_dossier_hors_portee_refuse(self):
        self.client.force_authenticate(self.intrus)
        resp = self.client.post(f'{URL_MODELES}depuis-ssdgps/', {'ssdgps': str(self.ssdgps.pk)},
                                format='json')
        self.assertEqual(resp.status_code, 404)

    def test_le_serializer_ssdgps_expose_le_modele(self):
        data = self.client.get(f'/api/v1/ssdgps/{self.ssdgps.pk}/').data
        self.assertEqual(data['modele'], self.modele_systeme().pk)
        self.assertEqual(data['modele_nom'], self.modele_systeme().nom)
        self.assertTrue(data['pieces_prevues'])
