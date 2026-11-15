"""
IA — configuration dans l'application, préférences, discussions de l'assistant et
gestion des observations des pièces.

Le service d'IA est toujours simulé (aucun appel réseau). Ce que ces tests verrouillent :
- la configuration saisie à l'écran PRIME sur l'environnement, en bloc ; la clé est
  chiffrée, jamais renvoyée, jamais journalisée ; seule l'administration de
  l'application modifie ;
- les discussions sont personnelles, recherchables (titres ET messages), renommables,
  épinglables, archivables, supprimables, exportables, régénérables ;
- une observation n'est jamais perdue : remplacée, supprimée ou restaurée, l'ancienne
  version est archivée ; un dossier figé refuse toute modification.
"""
import json
from datetime import datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from ia import client
from ia.models import ConfigurationIa, Conversation, MessageConversation, ObservationArchive, PreferenceIa
from ia.secret import chiffrer, dechiffrer
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()
ENV = dict(IA_ACTIVE=True, IA_FOURNISSEUR='omniroute', IA_BASE_URL='http://localhost:20128',
           IA_MODELE='Free-Combo', IA_CLE='cle-env-omniroute', ANTHROPIC_API_KEY='',
           IA_MODELES_SECOURS='', IA_COMPATIBLE=True, IA_PROTOCOLE='',
           PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


@override_settings(**ENV)
class GestionBaseTest(TestCase):
    def setUp(self):
        cache.clear()
        client.invalider_configuration()
        self.addCleanup(client.invalider_configuration)
        self.api = APIClient()
        self.org = Organization.objects.create(code='ORG-G', name='Org G')
        self.agent = self._user('agent@g.ma', 'ROLE_ORGANISATION_AGENT')
        self.autre = self._user('autre@g.ma', 'ROLE_ORGANISATION_AGENT')
        self.admin = User.objects.create_superuser(username='sa@g.ma', email='sa@g.ma', password='x')
        self.api.force_authenticate(self.agent)

    def _user(self, email, role):
        u = User.objects.create_user(username=email, email=email, password='x')
        Membership.objects.create(user=u, organization=self.org, role=role)
        return u


# =========================================================================== configuration

class ConfigurationTests(GestionBaseTest):
    URL = '/api/v1/ia/config/'

    def test_lecture_pour_tous_sans_la_cle(self):
        r = self.api.get(self.URL)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data['modifiable'])
        self.assertEqual(r.data['source'], 'environnement')
        self.assertEqual(r.data['effectif']['modele'], 'Free-Combo')
        self.assertEqual(r.data['effectif']['cle_origine'], 'environnement')
        self.assertNotIn('cle-env-omniroute', json.dumps(r.data, default=str))
        self.assertTrue(any(f['cle'] == 'openrouter' for f in r.data['catalogue']))

    def test_seule_l_administration_modifie(self):
        self.assertEqual(self.api.put(self.URL, {'modele': 'x'}, format='json').status_code, 403)
        for url in ('reinitialiser/', 'tester/'):
            self.assertEqual(self.api.post(self.URL + url).status_code, 403, url)

    def test_saisie_prime_en_bloc_sur_l_environnement(self):
        self.api.force_authenticate(self.admin)
        r = self.api.put(self.URL, {'fournisseur': 'openrouter', 'modele': 'm/libre:free',
                                    'modeles_secours': ['s1:free', 's2:free'],
                                    'cle': 'sk-or-v1-secret-tres-long-1234'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['source'], 'application')
        # L'adresse OmniRoute de l'environnement ne se mélange PAS au fournisseur saisi.
        self.assertEqual(client.adresse(), 'https://openrouter.ai/api/v1')
        self.assertEqual(client.protocole(), 'openai')
        self.assertEqual(client.cle(), 'sk-or-v1-secret-tres-long-1234')
        self.assertEqual(client.modeles_essai(), ['m/libre:free', 's1:free', 's2:free'])
        self.assertEqual(r.data['effectif']['cle_indice'], '1234')
        self.assertEqual(r.data['effectif']['cle_origine'], 'application')
        cfg = ConfigurationIa.objects.get(pk=1)
        self.assertNotIn('secret', cfg.cle_chiffree)               # chiffrée au repos
        self.assertEqual(dechiffrer(cfg.cle_chiffree), 'sk-or-v1-secret-tres-long-1234')
        self.assertNotIn('sk-or-v1', json.dumps(r.data, default=str))
        ev = AuditEvent.objects.get(action=AuditEvent.ACTION_IA_CONFIG)
        self.assertEqual(ev.details['cle'], 'remplacee')
        self.assertNotIn('sk-or-v1', json.dumps(ev.details))

    def test_meme_fournisseur_garde_la_cle_de_l_environnement(self):
        self.api.force_authenticate(self.admin)
        self.api.put(self.URL, {'fournisseur': 'omniroute', 'modele': 'auto/best-chat'}, format='json')
        self.assertEqual(client.cle(), 'cle-env-omniroute')
        self.assertEqual(client.modele(), 'auto/best-chat')

    def test_autre_fournisseur_sans_cle_reste_inerte(self):
        self.api.force_authenticate(self.admin)
        self.api.put(self.URL, {'fournisseur': 'google'}, format='json')
        self.assertEqual(client.cle(), '')
        self.assertFalse(client.disponible())

    def test_effacer_la_cle_et_desactiver(self):
        self.api.force_authenticate(self.admin)
        self.api.put(self.URL, {'fournisseur': 'groq', 'cle': 'gsk_cle_assez_longue_9999'}, format='json')
        r = self.api.put(self.URL, {'effacer_cle': True, 'actif': False}, format='json')
        self.assertFalse(r.data['saisie']['cle_enregistree'])
        self.assertFalse(client.actif())

    def test_validation(self):
        self.api.force_authenticate(self.admin)
        r = self.api.put(self.URL, {'fournisseur': 'inconnu', 'base_url': 'ftp://x', 'delai': 2,
                                    'protocole': 'grpc'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.data), {'fournisseur', 'base_url', 'delai', 'protocole'})

    def test_reinitialiser_revient_a_l_environnement(self):
        self.api.force_authenticate(self.admin)
        self.api.put(self.URL, {'fournisseur': 'groq', 'cle': 'gsk_cle_assez_longue_9999'}, format='json')
        r = self.api.post(self.URL + 'reinitialiser/')
        self.assertEqual(r.data['source'], 'environnement')
        self.assertEqual(client.adresse(), 'http://localhost:20128')

    def test_cle_illisible_apres_changement_de_secret(self):
        ConfigurationIa.objects.create(pk=1, fournisseur='groq', cle_chiffree='jeton-corrompu')
        client.invalider_configuration()
        self.assertEqual(client.cle(), '')
        self.assertTrue(self.api.get(self.URL).data['saisie']['cle_illisible'])

    def test_chiffrement_aller_retour(self):
        self.assertEqual(dechiffrer(chiffrer('abc')), 'abc')
        self.assertEqual(chiffrer(''), '')

    def test_essai_de_connexion(self):
        self.api.force_authenticate(self.admin)
        self.api.put(self.URL, {'fournisseur': 'openrouter', 'modele': 'm:free',
                                'cle': 'sk-or-v1-secret-tres-long-1234'}, format='json')
        reponse = SimpleNamespace(content=[SimpleNamespace(type='text', text='OK')], model='m:free',
                                  stop_reason='end_turn', usage=None)
        with patch('ia.openai_compat.lister_modeles', return_value=['m:free', 'n:free']), \
                patch('ia.openai_compat.creer', return_value=reponse):
            r = self.api.post(self.URL + 'tester/')
        self.assertTrue(r.data['ok'])
        self.assertEqual(r.data['modeles_accessibles'], 2)
        self.assertEqual(r.data['essais'][0]['reponse'], 'OK')


class ModelesEtPreferencesTests(GestionBaseTest):
    def test_liste_filtree_et_mise_en_cache(self):
        with patch('ia.views_config.lister_modeles', return_value=['a/x:free', 'b/y', 'c/z:free']) as lister:
            r1 = self.api.get('/api/v1/ia/modeles/?filtre=:free')
            self.api.get('/api/v1/ia/modeles/')
        self.assertEqual(r1.data['modeles'], ['a/x:free', 'c/z:free'])
        self.assertEqual(lister.call_count, 1)                      # 2e appel : cache

    def test_preference_du_modele_de_l_assistant(self):
        r = self.api.put('/api/v1/ia/preferences/', {'modele_assistant': 'auto/best-chat'}, format='json')
        self.assertEqual(r.data['modele_assistant'], 'auto/best-chat')
        self.assertEqual(client.modeles_essai(self.agent, 'assistant')[:2], ['auto/best-chat', 'Free-Combo'])
        # La préférence ne vaut QUE pour l'assistant, et que pour son auteur.
        self.assertEqual(client.modeles_essai(self.agent, 'redaction_observations')[0], 'Free-Combo')
        self.assertEqual(client.modeles_essai(self.autre, 'assistant')[0], 'Free-Combo')


# =========================================================================== discussions

def reponse_assistant(texte='Réponse.'):
    return {'reponse': texte, 'actions': [{'action': 'gerer_cachets', 'libelle': 'x',
                                           'route': 'parametres/cachets-signatures'}],
            'outils': ['tableau_de_bord'], 'modele': 'Free-Combo'}


class ConversationsTests(GestionBaseTest):
    URL = '/api/v1/ia/conversations/'

    def creer(self, titre=''):
        return self.api.post(self.URL, {'titre': titre}, format='json').data['id']

    def test_envoi_titre_automatique_et_enregistrement(self):
        cid = self.creer()
        with patch('ia.assistant.repondre', return_value=reponse_assistant('Voici vos dossiers.')) as rep:
            r = self.api.post(f'{self.URL}{cid}/messages/',
                              {'contenu': 'Quels dossiers attendent ma validation cette semaine ?'},
                              format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['message']['contenu'], 'Voici vos dossiers.')
        self.assertEqual(r.data['message']['modele'], 'Free-Combo')
        self.assertEqual(r.data['titre'], 'Quels dossiers attendent ma validation cette semaine ?')
        historique = rep.call_args.args[1]
        self.assertEqual(historique, [{'role': 'user',
                                       'content': 'Quels dossiers attendent ma validation cette semaine ?'}])
        d = self.api.get(f'{self.URL}{cid}/').data
        self.assertEqual([m['role'] for m in d['messages']], ['user', 'assistant'])
        self.assertEqual(d['messages'][1]['actions'][0]['action'], 'gerer_cachets')

    def test_echec_de_l_ia_garde_la_question_puis_regenerer(self):
        cid = self.creer('Essai')
        with patch('ia.assistant.repondre', side_effect=client.IaErreur('Service saturé')), \
                self.assertLogs('django.request', level='ERROR'):
            r = self.api.post(f'{self.URL}{cid}/messages/', {'contenu': 'Bonjour'}, format='json')
        self.assertEqual(r.status_code, 502)
        self.assertEqual(MessageConversation.objects.filter(conversation_id=cid).count(), 1)
        with patch('ia.assistant.repondre', return_value=reponse_assistant('Bonjour !')):
            r = self.api.post(f'{self.URL}{cid}/regenerer/')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(MessageConversation.objects.filter(conversation_id=cid).count(), 2)

    def test_regenerer_remplace_la_derniere_reponse(self):
        cid = self.creer('Essai')
        c = Conversation.objects.get(pk=cid)
        MessageConversation.objects.create(conversation=c, role='user', contenu='Q')
        MessageConversation.objects.create(conversation=c, role='assistant', contenu='Ancienne')
        with patch('ia.assistant.repondre', return_value=reponse_assistant('Nouvelle')):
            self.api.post(f'{self.URL}{cid}/regenerer/')
        self.assertEqual(list(c.messages.values_list('contenu', flat=True)), ['Q', 'Nouvelle'])

    def test_recherche_titres_et_messages_avec_extrait(self):
        a = Conversation.objects.create(proprietaire=self.agent, titre='Cachets')
        b = Conversation.objects.create(proprietaire=self.agent, titre='Divers')
        MessageConversation.objects.create(conversation=b, role='assistant',
                                           contenu='Le dossier Ferme Zaytoun a 7 pièces dont 3 validées.')
        r = self.api.get(self.URL + '?q=zaytoun')
        self.assertEqual([x['id'] for x in r.data], [str(b.id)])
        self.assertIn('Zaytoun', r.data[0]['extrait'])
        MessageConversation.objects.create(conversation=b, role='assistant',
                                           contenu='| **Ferme** | n°4 |\n|---|---|')
        r = self.api.get(self.URL + '?q=n°4')
        self.assertNotIn('|', r.data[0]['extrait'])                 # mise en forme retirée
        self.assertNotIn('**', r.data[0]['extrait'])
        self.assertEqual([x['id'] for x in self.api.get(self.URL + '?q=cachet').data], [str(a.id)])

    def test_renommer_epingler_archiver(self):
        a = self.creer('A')
        b = self.creer('B')
        self.api.patch(f'{self.URL}{a}/', {'titre': '  Mon   dossier  ', 'epinglee': True}, format='json')
        self.api.patch(f'{self.URL}{b}/', {'archivee': True}, format='json')
        actives = self.api.get(self.URL).data
        self.assertEqual([(x['titre'], x['epinglee']) for x in actives], [('Mon dossier', True)])
        self.assertEqual([x['id'] for x in self.api.get(self.URL + '?etat=archivees').data], [b])
        self.assertEqual(len(self.api.get(self.URL + '?etat=toutes').data), 2)
        r = self.api.patch(f'{self.URL}{a}/', {'titre': '   '}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_suppression_logique(self):
        cid = self.creer('A')
        self.assertEqual(self.api.delete(f'{self.URL}{cid}/').status_code, 204)
        self.assertEqual(self.api.get(f'{self.URL}{cid}/').status_code, 404)
        self.assertTrue(Conversation.objects.get(pk=cid).is_deleted)

    def test_discussions_strictement_personnelles(self):
        cid = self.creer('Privée')
        self.api.force_authenticate(self.autre)
        self.assertEqual(self.api.get(self.URL).data, [])
        for meth, url in (('get', ''), ('patch', ''), ('delete', ''), ('post', 'messages/'),
                          ('post', 'regenerer/'), ('get', 'export/')):
            r = getattr(self.api, meth)(f'{self.URL}{cid}/{url}', {'contenu': 'x'}, format='json')
            self.assertEqual(r.status_code, 404, (meth, url))
        self.api.force_authenticate(self.admin)                     # admin compris
        self.assertEqual(self.api.get(f'{self.URL}{cid}/').status_code, 404)

    def test_export_markdown(self):
        cid = self.creer('Cachets et signatures')
        c = Conversation.objects.get(pk=cid)
        MessageConversation.objects.create(conversation=c, role='user', contenu='Comment ?')
        MessageConversation.objects.create(conversation=c, role='assistant', contenu='Ainsi.')
        r = self.api.get(f'{self.URL}{cid}/export/')
        self.assertEqual(r.data['nom_fichier'], 'Cachets et signatures.md')
        self.assertIn('# Cachets et signatures', r.data['contenu'])
        self.assertIn('**Vous**', r.data['contenu'])
        self.assertIn('Ainsi.', r.data['contenu'])

    def test_message_vide_ou_trop_long(self):
        cid = self.creer('A')
        self.assertEqual(self.api.post(f'{self.URL}{cid}/messages/', {'contenu': ' '},
                                       format='json').status_code, 400)
        self.assertEqual(self.api.post(f'{self.URL}{cid}/messages/', {'contenu': 'x' * 5000},
                                       format='json').status_code, 400)


# =========================================================================== observations

class ObservationsTests(GestionBaseTest):
    def setUp(self):
        super().setUp()
        projet = Projet.objects.create(nom_projet='P', code_projet='P-OBS', organization=self.org,
                                       created_by=self.agent)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T1/A', projet=projet)
        affaire = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                         nature_affaire='BI', propriete=propriete,
                                         date_bornage=datetime(2024, 1, 1, tzinfo=dt_timezone.utc))
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='DLC/GPS', numero_ssdgps=1,
                                            type_ssdgps='mono-session', affaire=affaire)
        self.p1 = Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', ordre=0,
                                       commentaire='Ancienne observation', payload={'rows': [{'a': 1}]})
        self.p2 = Piece.objects.create(ssdgps=self.ssdgps, type_piece='RC', ordre=1,
                                       commentaire='Deuxième', payload={'rows': []})

    def post(self, url, donnees):
        return self.api.post(f'/api/v1/ia/observations/{url}', donnees, format='json')

    def test_appliquer_archive_l_ancienne_version(self):
        r = self.post('appliquer/', {'ssdgps': str(self.ssdgps.pk), 'observations': [
            {'piece': str(self.p1.pk), 'texte': 'Nouvelle  observation'},
            {'piece': str(self.p2.pk), 'texte': 'Deuxième'}]})            # inchangée
        self.assertEqual(r.data, {'modifiees': 1, 'ignorees': 0})
        self.p1.refresh_from_db()
        self.assertEqual((self.p1.commentaire, self.p1.updated_by), ('Nouvelle observation', self.agent))
        a = ObservationArchive.objects.get()
        self.assertEqual((a.texte, a.motif, a.created_by), ('Ancienne observation', 'remplacee', self.agent))

    def test_supprimer_une_ou_toutes(self):
        r = self.post('supprimer/', {'ssdgps': str(self.ssdgps.pk), 'pieces': [str(self.p1.pk)]})
        self.assertEqual(r.data['supprimees'], 1)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.commentaire, '')
        r = self.post('supprimer/', {'ssdgps': str(self.ssdgps.pk), 'toutes': True})
        self.assertEqual(r.data['supprimees'], 1)                     # p1 déjà vide
        self.assertEqual(ObservationArchive.objects.filter(motif='supprimee').count(), 2)
        self.assertEqual(self.post('supprimer/', {'ssdgps': str(self.ssdgps.pk)}).status_code, 400)

    def test_historique_et_restauration(self):
        self.post('supprimer/', {'ssdgps': str(self.ssdgps.pk), 'pieces': [str(self.p1.pk)]})
        h = self.api.get(f'/api/v1/ia/observations/historique/?ssdgps={self.ssdgps.pk}').data
        self.assertEqual((h[0]['texte'], h[0]['motif']), ('Ancienne observation', 'supprimee'))
        self.p1.commentaire = 'Texte courant'
        self.p1.save()
        r = self.post('restaurer/', {'archive': h[0]['id']})
        self.assertEqual(r.status_code, 200)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.commentaire, 'Ancienne observation')
        self.assertTrue(ObservationArchive.objects.filter(texte='Texte courant', motif='restauree').exists())

    def test_dossier_fige_refuse(self):
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut='soumis')
        for url, d in (('appliquer/', {'observations': [{'piece': str(self.p1.pk), 'texte': 'x'}]}),
                       ('supprimer/', {'toutes': True})):
            self.assertEqual(self.post(url, {'ssdgps': str(self.ssdgps.pk), **d}).status_code, 409, url)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.commentaire, 'Ancienne observation')

    def test_hors_droits(self):
        etranger = User.objects.create_user(username='e@x.ma', email='e@x.ma', password='x')
        Membership.objects.create(user=etranger, organization=Organization.objects.create(code='O2', name='O2'),
                                  role='ROLE_ORGANISATION_AGENT')
        self.post('supprimer/', {'ssdgps': str(self.ssdgps.pk), 'pieces': [str(self.p1.pk)]})
        archive = ObservationArchive.objects.get()
        self.api.force_authenticate(etranger)
        self.assertEqual(self.post('supprimer/', {'ssdgps': str(self.ssdgps.pk), 'toutes': True}).status_code, 404)
        self.assertEqual(self.post('restaurer/', {'archive': archive.id}).status_code, 404)
        self.assertEqual(self.api.get(f'/api/v1/ia/observations/historique/?ssdgps={self.ssdgps.pk}').status_code, 404)

    def test_regenerer_une_piece_avec_consigne(self):
        from ia.tests import brancher, reponse_json
        faux, branche = brancher(reponse_json({'observations': [
            {'piece': str(self.p2.pk), 'observation': 'Contrôle conforme.'}]}))
        with branche:
            r = self.post('', {'ssdgps': str(self.ssdgps.pk), 'pieces': [str(self.p2.pk)],
                               'consigne': 'Ton très bref', 'consignes': {str(self.p2.pk): 'Mentionner le RC'}})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([p['piece'] for p in r.data['propositions']], [str(self.p2.pk)])
        contenu = faux.appels[0]['messages'][0]['content']
        self.assertIn('Ton très bref', contenu)
        self.assertIn('Mentionner le RC', contenu)
        self.assertNotIn(str(self.p1.pk), contenu)                   # seule la pièce visée
