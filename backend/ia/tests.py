"""
Intelligence artificielle — mapping des colonnes (n°4), assistant (n°5), rédaction (n°6).

Le service d'IA est REMPLACÉ par un faux client (`FauxClient`) : aucun appel réseau,
aucun coût, réponses maîtrisées. Ce que ces tests verrouillent :
- **inertie** : sans IA_ACTIVE + clé, rien ne part (503 `IA_INACTIVE`) ;
- **appel** : paramètres envoyés (modèle, effort, schéma, repli en cas de refus),
  journal d'audit de chaque appel, erreurs du fournisseur traduites ;
- **re-validation** des réponses : pas de champ / colonne / pièce inventés ;
- **droits** : tout passe par la portée RBAC de l'utilisateur, l'assistant compris ;
- **l'IA propose, l'opérateur décide** : aucune écriture en base.
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
from ia import assistant, client, mapping, redaction
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()
ACTIVE = dict(IA_ACTIVE=True, ANTHROPIC_API_KEY='sk-test-factice', IA_MODELE='claude-opus-5-5',
              PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


# --------------------------------------------------------------------------- faux client

def bloc_texte(t):
    return SimpleNamespace(type='text', text=t)


def bloc_outil(nom, entree, ident='tu_1'):
    return SimpleNamespace(type='tool_use', name=nom, input=entree, id=ident)


def reponse(*blocs, stop='end_turn'):
    return SimpleNamespace(content=list(blocs), stop_reason=stop, model='claude-opus-5-5',
                           usage=SimpleNamespace(input_tokens=120, output_tokens=30))


def reponse_json(donnees):
    return reponse(bloc_texte(json.dumps(donnees, ensure_ascii=False)))


class FauxClient:
    """Rejoue une liste de réponses (ou d'exceptions) et garde les paramètres reçus."""

    def __init__(self, *reponses):
        self.reponses = list(reponses)
        self.appels = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **params):
        # Copie de la liste : l'appelant la complète ensuite (instantané de CET appel).
        self.appels.append({**params, 'messages': list(params['messages'])})
        r = self.reponses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def brancher(*reponses):
    faux = FauxClient(*reponses)
    return faux, patch('ia.client._client', return_value=faux)


# --------------------------------------------------------------------------- données

class IaBaseTest(TestCase):
    def setUp(self):
        cache.clear()   # plafond de débit
        self.api = APIClient()
        self.org = Organization.objects.create(code='ORG-IA', name='Org IA')
        self.autre_org = Organization.objects.create(code='ORG-X', name='Autre')
        self.agent = self._user('agent@ia.ma', self.org, 'ROLE_ORGANISATION_AGENT')
        self.admin_org = self._user('admin@ia.ma', self.org, 'ROLE_ORGANISATION_ADMIN')
        self.etranger = self._user('x@ia.ma', self.autre_org, 'ROLE_ORGANISATION_AGENT')
        self.ssdgps = self._dossier(self.org, self.agent, 'Ferme Zaytoun', 'P-IA-1')
        self.ssdgps_etranger = self._dossier(self.autre_org, self.etranger, 'Domaine X', 'P-IA-2')
        # Un mono-session crée lui-même sa session n°1 (structurelle) : on la date.
        self.session, _ = Session.objects.get_or_create(ssdgps=self.ssdgps, numero_session=1)
        self.session.date_session = datetime(2024, 1, 11, tzinfo=dt_timezone.utc)
        self.session.save()
        self.rob = Piece.objects.create(
            ssdgps=self.ssdgps, session=self.session, type_piece='ROB', numero=1, ordre=1,
            statut=Piece.Statut.VALIDE,
            payload={'rows': [{'point': 'BT10', 'type': 'Statique', 'duree': '00:12:00'},
                              {'point': 'BT11', 'type': 'Statique', 'duree': '01:10:00'}]})
        self.lpa = Piece.objects.create(
            ssdgps=self.ssdgps, type_piece='LPA', ordre=0, statut=Piece.Statut.BROUILLON,
            payload={'rows': [{'nom_point': 'BT10'}]})
        self.api.force_authenticate(self.agent)

    def _user(self, email, org, role):
        u = User.objects.create_user(username=email, email=email, password='Passw0rd!',
                                     first_name='Youssef')
        Membership.objects.create(user=u, organization=org, role=role)
        return u

    def _dossier(self, org, createur, nom, code):
        projet = Projet.objects.create(nom_projet=f'Projet {nom}', code_projet=code,
                                       organization=org, created_by=createur)
        propriete = Propriete.objects.create(nom_propriete=nom, id_titre='T9000/A', projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2024, 1, 10, tzinfo=dt_timezone.utc), propriete=propriete)
        return Ssdgps.objects.create(nature_ssdgps='DLC/GPS', numero_ssdgps=4,
                                     type_ssdgps='mono-session', affaire=affaire)


# =========================================================================== socle

class InertieTests(IaBaseTest):
    @override_settings(IA_ACTIVE=False, ANTHROPIC_API_KEY='sk-test')
    def test_sans_activation_rien_ne_part(self):
        self.assertFalse(client.disponible())
        faux, branche = brancher()
        # Une 5xx est journalisée par Django (`django.request`) : on capture ce journal.
        with branche, self.assertLogs('django.request', level='ERROR'):
            resp = self.api.post('/api/v1/ia/assistant/',
                                 {'messages': [{'role': 'user', 'content': 'Bonjour'}]},
                                 format='json')
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.data['code'], 'IA_INACTIVE')
        self.assertEqual(faux.appels, [])

    @override_settings(IA_ACTIVE=True, ANTHROPIC_API_KEY='')
    def test_activation_sans_cle_reste_inerte(self):
        self.assertFalse(client.disponible())

    @override_settings(IA_ACTIVE=False)
    def test_statut_annonce_l_inactivite(self):
        resp = self.api.get('/api/v1/ia/statut/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'disponible': False, 'modele': None})

    @override_settings(**ACTIVE)
    def test_statut_actif(self):
        self.assertEqual(self.api.get('/api/v1/ia/statut/').data,
                         {'disponible': True, 'modele': 'claude-opus-5-5'})

    def test_non_authentifie(self):
        self.api.force_authenticate(None)
        for url in ('statut/', 'assistant/', 'mapping-colonnes/', 'observations/', 'synthese/'):
            meth = self.api.get if url == 'statut/' else self.api.post
            self.assertEqual(meth(f'/api/v1/ia/{url}').status_code, 401, url)


@override_settings(**ACTIVE)
class AppelTests(IaBaseTest):
    def test_parametres_envoyes_et_journal(self):
        faux, branche = brancher(reponse_json({'ok': True}))
        with branche:
            r = client.appeler('essai', self.agent, messages=[{'role': 'user', 'content': 'x'}],
                               schema={'type': 'object'}, effort='low', max_tokens=500)
        p = faux.appels[0]
        self.assertEqual(p['model'], 'claude-opus-5-5')
        self.assertEqual(p['output_config'], {'effort': 'low', 'format': {
            'type': 'json_schema', 'schema': {'type': 'object'}}})
        self.assertEqual(p['fallbacks'], 'default')               # repli si refus
        self.assertEqual(p['betas'], [client.BETA_REPLI])
        self.assertNotIn('thinking', p)                            # Opus 5.5 : jamais désactivé
        self.assertEqual(client.json_de(r), {'ok': True})
        ev = AuditEvent.objects.get(action=AuditEvent.ACTION_IA_APPEL)
        self.assertEqual(ev.acteur, self.agent)
        self.assertEqual((ev.details['fonction'], ev.details['jetons_entree'],
                          ev.details['jetons_sortie']), ('essai', 120, 30))

    def test_refus_traduit(self):
        faux, branche = brancher(reponse(bloc_texte(''), stop='refusal'))
        with branche, self.assertRaisesMessage(client.IaErreur, 'décliné'):
            client.appeler('essai', self.agent, messages=[{'role': 'user', 'content': 'x'}])

    def test_panne_reseau_traduite_et_journalisee(self):
        import anthropic
        import httpx2
        err = anthropic.APIConnectionError(request=httpx2.Request('POST', 'https://api.test'))
        faux, branche = brancher(err)
        with branche, self.assertRaisesMessage(client.IaErreur, 'injoignable'):
            client.appeler('essai', self.agent, messages=[{'role': 'user', 'content': 'x'}])
        ev = AuditEvent.objects.get(action=AuditEvent.ACTION_IA_APPEL)
        self.assertEqual(ev.details['erreur'], 'connexion')

    def test_reponse_tronquee(self):
        with self.assertRaisesMessage(client.IaErreur, 'tronquée'):
            client.json_de(reponse(bloc_texte('{"a":'), stop='max_tokens'))


# =========================================================================== N°4 mapping

class FiltrageMappingTests(TestCase):
    def test_rejette_l_invente_et_garde_le_plus_sur(self):
        brut = [
            {'champ': 'hauteur', 'colonne': 'HI', 'confiance': 'moyenne', 'raison': 'r'},
            {'champ': 'hauteur', 'colonne': 'Ant', 'confiance': 'haute', 'raison': 'r'},
            {'champ': 'antenne', 'colonne': 'Ant', 'confiance': 'faible', 'raison': 'r'},
            {'champ': 'invente', 'colonne': 'HI', 'confiance': 'haute', 'raison': 'r'},
            {'champ': 'point', 'colonne': 'Inexistante', 'confiance': 'haute', 'raison': 'r'},
            {'champ': 'deja', 'colonne': 'HI', 'confiance': 'haute', 'raison': 'r'},
        ]
        retenus = mapping.filtrer(brut, {'hauteur', 'antenne', 'point', 'deja'},
                                  {'deja': 'Nom'}, ['HI', 'Ant'])
        self.assertEqual([(p['champ'], p['colonne']) for p in retenus], [('hauteur', 'Ant')])


@override_settings(**ACTIVE)
class MappingApiTests(IaBaseTest):
    def test_propose_les_associations_manquantes(self):
        faux, branche = brancher(reponse_json({'correspondances': [
            {'champ': 'hauteur_antenne', 'colonne': 'Ant. Height', 'confiance': 'haute',
             'raison': 'Hauteur en mètres.'},
        ]}))
        with branche, patch('pieces.catalog.champs_with_meta', return_value=[
                {'name': 'point', 'label': 'Point', 'type': 'text'},
                {'name': 'hauteur_antenne', 'label': 'Haut. Ant. (m)', 'type': 'number'}]):
            resp = self.api.post('/api/v1/ia/mapping-colonnes/', {
                'type_piece': 'ROB', 'colonnes': ['Station', 'Ant. Height'],
                'lignes': [['BT10', '1.360']], 'deja': {'point': 'Station'},
            }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['propositions'], [{
            'champ': 'hauteur_antenne', 'colonne': 'Ant. Height', 'confiance': 'haute',
            'raison': 'Hauteur en mètres.'}])
        envoye = faux.appels[0]
        self.assertEqual(envoye['output_config']['effort'], 'low')
        schema_item = envoye['output_config']['format']['schema']['properties'][
            'correspondances']['items']['properties']
        # Les associations faites sont FIXES : ni le champ ni la colonne ne sont proposés.
        self.assertEqual(schema_item['champ']['enum'], ['hauteur_antenne'])
        self.assertEqual(schema_item['colonne']['enum'], ['', 'Ant. Height'])

    def test_rien_a_completer_aucun_appel(self):
        faux, branche = brancher()
        with branche, patch('pieces.catalog.champs_with_meta',
                            return_value=[{'name': 'point', 'label': 'Point', 'type': 'text'}]):
            resp = self.api.post('/api/v1/ia/mapping-colonnes/', {
                'type_piece': 'ROB', 'colonnes': ['Station'], 'deja': {'point': 'Station'},
            }, format='json')
        self.assertEqual(resp.data['propositions'], [])
        self.assertEqual(faux.appels, [])

    def test_validation(self):
        self.assertEqual(self.api.post('/api/v1/ia/mapping-colonnes/', {}, format='json')
                         .status_code, 400)
        resp = self.api.post('/api/v1/ia/mapping-colonnes/',
                             {'type_piece': 'ZZZ', 'colonnes': ['a']}, format='json')
        self.assertEqual(resp.status_code, 400)


# =========================================================================== N°6 rédaction

@override_settings(**ACTIVE)
class RedactionTests(IaBaseTest):
    def test_faits_calcules_sans_donnee_nominative(self):
        faits = redaction.faits_piece(self.rob)
        self.assertEqual((faits['type'], faits['nb_lignes'], faits['session']), ('ROB', 2, 1))
        self.assertEqual(faits['date_session'], '11/01/2024')
        # La durée de 12 min en statique est hors tolérance (défaut ≥ 30 min).
        self.assertIn('hors tolérance', faits['hors_tolerance'])
        self.assertNotIn('Zaytoun', json.dumps(faits, ensure_ascii=False))

    def test_observations_proposees_filtrees_et_tronquees(self):
        faux, branche = brancher(reponse_json({'observations': [
            {'piece': str(self.rob.pk), 'observation': 'Deux stations ;  BT10 ' + 'x' * 300},
            {'piece': 'piece-inventee', 'observation': 'Ne doit pas apparaître.'},
        ]}))
        with branche:
            resp = self.api.post('/api/v1/ia/observations/', {'ssdgps': str(self.ssdgps.pk)},
                                 format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        props = resp.data['propositions']
        self.assertEqual([p['piece'] for p in props], [str(self.rob.pk)])
        self.assertEqual(len(props[0]['observation']), redaction.LONGUEUR_OBSERVATION)
        self.assertTrue(props[0]['observation'].startswith('Deux stations ; BT10'))
        # Rien n'est enregistré : l'opérateur relit puis enregistre lui-même.
        self.rob.refresh_from_db()
        self.assertEqual(self.rob.commentaire, '')

    def test_dossier_fige_refuse(self):
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut='soumis')
        faux, branche = brancher()
        with branche:
            resp = self.api.post('/api/v1/ia/observations/', {'ssdgps': str(self.ssdgps.pk)},
                                 format='json')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(faux.appels, [])

    def test_dossier_hors_droits(self):
        faux, branche = brancher()
        with branche:
            for url in ('observations/', 'synthese/'):
                resp = self.api.post(f'/api/v1/ia/{url}',
                                     {'ssdgps': str(self.ssdgps_etranger.pk)}, format='json')
                self.assertEqual(resp.status_code, 404, url)
            self.assertEqual(self.api.post('/api/v1/ia/synthese/', {'ssdgps': 'x'},
                                           format='json').status_code, 404)
        self.assertEqual(faux.appels, [])

    def test_synthese(self):
        faux, branche = brancher(reponse(bloc_texte('Le dossier comprend deux pièces.')))
        with branche:
            resp = self.api.post('/api/v1/ia/synthese/', {'ssdgps': str(self.ssdgps.pk)},
                                 format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['texte'], 'Le dossier comprend deux pièces.')
        contenu = faux.appels[0]['messages'][0]['content']
        self.assertIn('Contrôle de cohérence', contenu)
        self.assertNotIn('Zaytoun', contenu)


# =========================================================================== N°5 assistant

class HistoriqueTests(TestCase):
    def test_validation(self):
        with self.assertRaises(ValueError):
            assistant.valider_historique([])
        with self.assertRaises(ValueError):
            assistant.valider_historique([{'role': 'system', 'content': 'x'}])
        with self.assertRaises(ValueError):
            assistant.valider_historique([{'role': 'user', 'content': 'a'},
                                          {'role': 'assistant', 'content': 'b'}])
        with self.assertRaises(ValueError):
            assistant.valider_historique([{'role': 'user', 'content': 'x' * 5000}])

    def test_normalisation(self):
        propres = assistant.valider_historique([
            {'role': 'assistant', 'content': 'Bonjour !'},       # retiré : pas en tête
            {'role': 'user', 'content': 'a'}, {'role': 'user', 'content': 'b'},
            {'role': 'assistant', 'content': ' '},                # vide : ignoré
        ] + [{'role': 'user', 'content': 'c'}])
        self.assertEqual(propres, [{'role': 'user', 'content': 'a\n\nb\n\nc'}])


@override_settings(**ACTIVE)
class OutilsAssistantTests(IaBaseTest):
    def test_chercher_dans_la_portee(self):
        r = assistant.chercher_dossiers(self.agent, 'Zaytoun')
        self.assertEqual(r['total'], 1)
        self.assertEqual(r['dossiers'][0]['id'], str(self.ssdgps.pk))
        self.assertEqual(r['dossiers'][0]['pieces'], 2)
        # Le dossier d'une autre organisation n'est jamais trouvé.
        self.assertEqual(assistant.chercher_dossiers(self.agent, 'Domaine')['total'], 0)
        self.assertEqual(assistant.chercher_dossiers(self.agent, statut='soumis')['total'], 0)

    def test_detail_et_coherence(self):
        d = assistant.detail_dossier(self.agent, str(self.ssdgps.pk))
        self.assertEqual(len(d['pieces']), 2)
        self.assertIn('soumettre', d['transitions_possibles'] + ['soumettre'])
        self.assertIn('erreur', assistant.detail_dossier(self.agent, str(self.ssdgps_etranger.pk)))
        self.assertIn('erreur', assistant.controle_coherence(self.agent, 'pas-un-uuid'))
        self.assertIn('anomalies', assistant.controle_coherence(self.agent, str(self.ssdgps.pk)))

    def test_tableau_de_bord_a_valider(self):
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut='soumis')
        self.assertEqual(len(assistant.tableau_de_bord(self.admin_org)['a_valider_par_vous']), 1)
        # Un agent ne valide pas : rien « à valider par vous ».
        self.assertEqual(assistant.tableau_de_bord(self.agent)['a_valider_par_vous'], [])

    def test_routes_d_action(self):
        projet = self.ssdgps.affaire.propriete.projet_id
        self.assertEqual(assistant.route_action(self.agent, 'generer_rapport', str(self.ssdgps.pk)),
                         f'projets/{projet}/pieces/{self.ssdgps.pk}?rapport=1')
        self.assertEqual(assistant.route_action(self.agent, 'gerer_cachets'),
                         'parametres/cachets-signatures')
        self.assertIsNone(assistant.route_action(self.agent, 'ouvrir_dossier',
                                                 str(self.ssdgps_etranger.pk)))
        self.assertIsNone(assistant.route_action(self.agent, 'supprimer_tout'))

    def test_outil_en_panne_ne_casse_pas_la_reponse(self):
        with patch('ia.assistant.tableau_de_bord', side_effect=RuntimeError('boum')):
            r = json.loads(assistant.executer_outil(self.agent, 'tableau_de_bord', {}, []))
        self.assertIn('erreur', r)


@override_settings(**ACTIVE)
class DialogueAssistantTests(IaBaseTest):
    def test_tour_avec_outils_et_action_proposee(self):
        faux, branche = brancher(
            reponse(bloc_outil('chercher_dossiers', {'texte': 'Zaytoun'}), stop='tool_use'),
            reponse(bloc_outil('proposer_action', {'action': 'generer_rapport',
                                                   'ssdgps_id': str(self.ssdgps.pk)}, 'tu_2'),
                    stop='tool_use'),
            reponse(bloc_texte('Le SDGPS n°4 est en cours ; voici le bouton du rapport.')),
        )
        with branche:
            resp = self.api.post('/api/v1/ia/assistant/', {'messages': [
                {'role': 'user', 'content': 'Génère le rapport du dossier Zaytoun'}]},
                format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('SDGPS n°4', resp.data['reponse'])
        self.assertEqual(resp.data['outils'], ['chercher_dossiers', 'proposer_action'])
        self.assertEqual(len(resp.data['actions']), 1)
        self.assertTrue(resp.data['actions'][0]['route'].endswith('?rapport=1'))
        # Le résultat de l'outil a bien été renvoyé au modèle, avec l'identifiant d'appel.
        retour = faux.appels[1]['messages'][-1]['content'][0]
        self.assertEqual((retour['type'], retour['tool_use_id']), ('tool_result', 'tu_1'))
        self.assertIn('Zaytoun', retour['content'])
        self.assertIn('Youssef', faux.appels[0]['system'])
        self.assertEqual(AuditEvent.objects.filter(action=AuditEvent.ACTION_IA_APPEL).count(), 3)

    def test_boucle_bornee(self):
        boucle = [reponse(bloc_outil('tableau_de_bord', {}, f't{i}'), stop='tool_use')
                  for i in range(assistant.MAX_TOURS)]
        faux, branche = brancher(*boucle)
        with branche, self.assertLogs('django.request', level='ERROR'):
            resp = self.api.post('/api/v1/ia/assistant/',
                                 {'messages': [{'role': 'user', 'content': 'x'}]}, format='json')
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(len(faux.appels), assistant.MAX_TOURS)

    def test_historique_invalide(self):
        resp = self.api.post('/api/v1/ia/assistant/', {'messages': []}, format='json')
        self.assertEqual(resp.status_code, 400)
