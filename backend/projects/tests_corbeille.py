"""
Suppressions journalisées + corbeille générale.

- mise en corbeille, restauration (unitaire et en masse) et suppression définitive
  (unitaire et en masse) de projets → pièces sont TOUTES tracées dans le journal d'audit ;
  la suppression définitive consigne ce qu'elle emporte (descendants en cascade) ;
- `GET corbeille/` liste tous les niveaux, portée RBAC ; `restaurer/` et `purger/`
  agissent en lot, feuilles d'abord, et respectent le verrou d'un dossier figé.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Membership, Organization
from pieces.models import Piece
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class CorbeilleBase(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-C', name='Org Corbeille')
        self.moi = User.objects.create_user(username='c@c.ma', email='c@c.ma', password='Passw0rd!')
        Membership.objects.create(user=self.moi, organization=self.org, role='ROLE_ORGANISATION_AGENT')
        self.projet = Projet.objects.create(nom_projet='Projet', code_projet='PC-1', organization=self.org,
                                            created_by=self.moi)
        self.prop = Propriete.objects.create(nom_propriete='Prop C', id_requisition='R1/1', projet=self.projet)
        self.aff = Affaire.objects.create(numero_sd_affaire=7, nature_procedure_affaire='IFF', nature_affaire='BI',
                                          date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
                                          propriete=self.prop)
        self.ss = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1, type_ssdgps='multi-session',
                                        affaire=self.aff)
        self.sess = Session.objects.create(ssdgps=self.ss, numero_session=1,
                                           date_session=datetime(2024, 1, 1, tzinfo=dt_timezone.utc))
        self.piece = Piece.objects.create(ssdgps=self.ss, session=self.sess, type_piece='ROB', numero=1,
                                          payload={'rows': [{'point': 'A'}, {'point': 'B'}]})
        self.client = APIClient()
        self.client.force_authenticate(self.moi)

    def evenements(self, action):
        return list(AuditEvent.objects.filter(action=action).order_by('created_at'))


class JournalTests(CorbeilleBase):
    def test_corbeille_restauration_definitive_d_une_piece(self):
        self.assertEqual(self.client.delete(f'/api/v1/pieces/{self.piece.pk}/').status_code, 204)
        [ev] = self.evenements(AuditEvent.ACTION_ELEMENT_SUPPRIME)
        self.assertEqual(ev.cible_id, str(self.piece.pk))
        self.assertEqual(ev.details['type_element'], 'piece')
        self.assertIn('SDGPS n°1', ev.details['contexte'])
        self.assertEqual(ev.acteur_id, self.moi.pk)

        self.client.post(f'/api/v1/pieces/{self.piece.pk}/restore/')
        self.assertEqual(len(self.evenements(AuditEvent.ACTION_ELEMENT_RESTAURE)), 1)

        self.client.delete(f'/api/v1/pieces/{self.piece.pk}/')
        self.assertEqual(self.client.delete(f'/api/v1/pieces/{self.piece.pk}/permanent/').status_code, 204)
        [ev] = self.evenements(AuditEvent.ACTION_SUPPRESSION_DEFINITIVE)
        self.assertEqual(ev.details['emporte'], {'lignes': 2})
        self.assertFalse(Piece.objects.filter(pk=self.piece.pk).exists())

    def test_definitive_d_une_propriete_consigne_la_cascade(self):
        self.client.delete(f'/api/v1/proprietes/{self.prop.pk}/')
        resp = self.client.post('/api/v1/proprietes/permanent-delete/', {'ids': [str(self.prop.pk)]}, format='json')
        # La propriété a encore une affaire active : refusée (règle « bottom-up »)…
        self.assertEqual(resp.data['deleted_count'], 0)
        Affaire.objects.filter(pk=self.aff.pk).update(is_deleted=True)
        resp = self.client.post('/api/v1/proprietes/permanent-delete/', {'ids': [str(self.prop.pk)]}, format='json')
        self.assertEqual(resp.data['deleted_count'], 1)
        [ev] = self.evenements(AuditEvent.ACTION_SUPPRESSION_DEFINITIVE)
        self.assertEqual(ev.cible_libelle, 'Prop C')
        self.assertEqual(ev.details['emporte'], {'affaires': 1, 'ssdgps': 1, 'sessions': 1, 'pieces': 1})
        self.assertEqual(ev.details['contexte'], 'PC-1 — Projet')

    def test_restauration_en_masse_tracee(self):
        self.client.delete(f'/api/v1/affaires/{self.aff.pk}/')
        self.client.post('/api/v1/affaires/bulk-restore/', {'ids': [str(self.aff.pk)]}, format='json')
        [ev] = self.evenements(AuditEvent.ACTION_ELEMENT_RESTAURE)
        self.assertEqual(ev.cible_libelle, 'SD 7 — BI')


class CorbeilleGeneraleTests(CorbeilleBase):
    URL = '/api/v1/corbeille/'

    def test_liste_tous_les_niveaux_du_plus_recent_au_plus_ancien(self):
        self.client.delete(f'/api/v1/pieces/{self.piece.pk}/')
        self.client.delete(f'/api/v1/ssdgps/{self.ss.pk}/')
        data = self.client.get(self.URL).data
        self.assertEqual(data['total'], 2)
        premier, second = data['resultats']
        self.assertEqual((premier['type'], second['type']), ('ssdgps', 'piece'))
        self.assertEqual(premier['enfants_actifs'], 1)          # sa session est encore active
        self.assertTrue(second['parent_en_corbeille'])
        self.assertEqual(second['deleted_by'], 'c@c.ma')

    def test_restaurer_en_lot(self):
        self.client.delete(f'/api/v1/pieces/{self.piece.pk}/')
        resp = self.client.post(f'{self.URL}restaurer/', {'elements': [{'type': 'piece', 'id': str(self.piece.pk)}]},
                                format='json')
        self.assertEqual(resp.data['restaures'], 1)
        self.assertFalse(Piece.objects.get(pk=self.piece.pk).is_deleted)

    def test_purger_feuilles_d_abord(self):
        for url in (f'/api/v1/pieces/{self.piece.pk}/', f'/api/v1/sessions/{self.sess.pk}/',
                    f'/api/v1/ssdgps/{self.ss.pk}/'):
            self.client.delete(url)
        elements = [{'type': 'ssdgps', 'id': str(self.ss.pk)}, {'type': 'session', 'id': str(self.sess.pk)},
                    {'type': 'piece', 'id': str(self.piece.pk)}]
        resp = self.client.post(f'{self.URL}purger/', {'elements': elements}, format='json')
        self.assertEqual((resp.data['supprimes'], resp.data['erreurs']), (3, []))
        self.assertFalse(Ssdgps.objects.filter(pk=self.ss.pk).exists())
        self.assertEqual(len(self.evenements(AuditEvent.ACTION_SUPPRESSION_DEFINITIVE)), 3)

    def test_parent_encore_garni_refuse(self):
        self.client.delete(f'/api/v1/ssdgps/{self.ss.pk}/')
        resp = self.client.post(f'{self.URL}purger/', {'elements': [{'type': 'ssdgps', 'id': str(self.ss.pk)}]},
                                format='json')
        self.assertEqual(resp.data['supprimes'], 0)
        self.assertIn('sous-élément', resp.data['erreurs'][0]['detail'])

    def test_dossier_fige_piece_protegee(self):
        self.client.delete(f'/api/v1/pieces/{self.piece.pk}/')
        Ssdgps.objects.filter(pk=self.ss.pk).update(statut='soumis')
        el = [{'type': 'piece', 'id': str(self.piece.pk)}]
        self.assertEqual(self.client.post(f'{self.URL}purger/', {'elements': el}, format='json').data['supprimes'], 0)
        self.assertEqual(self.client.post(f'{self.URL}restaurer/', {'elements': el}, format='json').data['restaures'], 0)
        self.assertTrue(self.client.get(self.URL).data['resultats'][0]['verrouille'])

    def test_rbac_autre_organisation(self):
        self.client.delete(f'/api/v1/pieces/{self.piece.pk}/')
        autre = Organization.objects.create(code='ORG-Y', name='Y')
        intrus = User.objects.create_user(username='y@y.ma', email='y@y.ma', password='Passw0rd!')
        Membership.objects.create(user=intrus, organization=autre, role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(intrus)
        self.assertEqual(self.client.get(self.URL).data['total'], 0)
        resp = self.client.post(f'{self.URL}purger/', {'elements': [{'type': 'piece', 'id': str(self.piece.pk)}]},
                                format='json')
        self.assertEqual(resp.data['supprimes'], 0)
        self.assertTrue(Piece.objects.filter(pk=self.piece.pk).exists())

    def test_element_invalide(self):
        resp = self.client.post(f'{self.URL}purger/', {'elements': [{'type': 'bidon', 'id': 'x'}]}, format='json')
        self.assertEqual(resp.data['erreurs'][0]['detail'], 'Élément invalide.')

    def test_anonyme(self):
        self.assertEqual(APIClient().get(self.URL).status_code, 401)
