"""
« Reprendre mon travail » (`GET /api/v1/reprise/`) : travaux commencés et non terminés de
l'appelant, du plus récent au plus ancien.
"""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces.models import Piece, RapportGeneration
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()
URL = '/api/v1/reprise/'


class RepriseTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-R', name='Org Reprise')
        self.moi = self._membre('moi@r.ma')
        self.collegue = self._membre('collegue@r.ma')
        self.client = APIClient()
        self.client.force_authenticate(self.moi)

    def _membre(self, email, org=None):
        u = User.objects.create_user(username=email, email=email, password='Passw0rd!')
        Membership.objects.create(user=u, organization=org or self.org, role='ROLE_ORGANISATION_AGENT')
        return u

    def _hierarchie(self, createur, code='P-1', type_ssdgps='mono-session', avec_ssdgps=True):
        projet = Projet.objects.create(nom_projet='Projet', code_projet=code, organization=self.org,
                                       created_by=createur)
        prop = Propriete.objects.create(nom_propriete='Prop', id_requisition='R1/1', projet=projet,
                                        created_by=createur)
        aff = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
                                     date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
                                     propriete=prop, created_by=createur)
        ss = None
        if avec_ssdgps:
            ss = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1, type_ssdgps=type_ssdgps,
                                       affaire=aff, created_by=createur)
        return projet, prop, aff, ss

    def _date(self, obj, jours):
        type(obj).objects.filter(pk=obj.pk).update(updated_at=timezone.now() - timedelta(days=jours))

    def _resultats(self, **params):
        resp = self.client.get(URL, params)
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.data['resultats']

    def test_anonyme_refuse(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)

    def test_ssdgps_en_cours_avec_progression_derniere_piece_et_prochaine_etape(self):
        projet, prop, aff, ss = self._hierarchie(self.moi)
        Piece.objects.create(ssdgps=ss, type_piece='LPA', statut='valide', created_by=self.moi)
        rdia = Piece.objects.create(ssdgps=ss, type_piece='RDIA', created_by=self.moi)
        [t] = [t for t in self._resultats() if t['type'] == 'ssdgps']
        self.assertEqual(t['progression'], {'validees': 1, 'total': 2})
        self.assertEqual(t['a_faire'], '1 pièce à valider')
        self.assertEqual(t['derniere_piece']['type_piece'], 'RDIA')
        self.assertEqual(t['derniere_piece']['lien'], f'projets/{projet.id}/pieces/{ss.id}/piece/{rdia.id}')
        self.assertEqual(t['lien'], f'projets/{projet.id}/pieces/{ss.id}?proprieteId={prop.id}&affaireId={aff.id}')
        self.assertIsNone(t['session'])                  # mono-session : jamais de session

    def test_ordre_du_plus_recent_au_plus_ancien(self):
        _, _, _, ancien = self._hierarchie(self.moi, 'P-ANCIEN')
        _, _, _, recent = self._hierarchie(self.moi, 'P-RECENT')
        self._date(ancien, 10)
        self._date(recent, 1)
        ids = [t['id'] for t in self._resultats() if t['type'] == 'ssdgps']
        self.assertEqual(ids, [str(recent.id), str(ancien.id)])

    def test_dossier_soumis_ou_valide_n_est_plus_a_reprendre(self):
        _, _, _, ss = self._hierarchie(self.moi)
        Ssdgps.objects.filter(pk=ss.pk).update(statut='soumis')
        self.assertFalse([t for t in self._resultats() if t['type'] == 'ssdgps'])

    def test_dossier_d_un_collegue_que_je_n_ai_pas_touche_absent(self):
        _, _, _, ss = self._hierarchie(self.collegue)
        self.assertFalse(self._resultats())
        # … mais présent dès que j'y modifie une pièce
        Piece.objects.create(ssdgps=ss, type_piece='LPA', created_by=self.collegue, updated_by=self.moi)
        self.assertEqual([t['id'] for t in self._resultats()], [str(ss.id)])

    def test_multi_session_lien_vers_la_session_de_la_derniere_piece(self):
        _, _, _, ss = self._hierarchie(self.moi, type_ssdgps='multi-session')
        s2 = Session.objects.create(ssdgps=ss, numero_session=2,
                                    date_session=datetime(2024, 1, 2, tzinfo=dt_timezone.utc))
        Piece.objects.create(ssdgps=ss, session=s2, type_piece='ROB', numero=1, created_by=self.moi)
        [t] = [t for t in self._resultats() if t['type'] == 'ssdgps']
        self.assertEqual(t['session'], {'numero': 2})
        self.assertIn(f'&session={s2.id}', t['lien'])

    def test_renvoye_en_saisie_avec_motif(self):
        _, _, _, ss = self._hierarchie(self.moi)
        Ssdgps.objects.filter(pk=ss.pk).update(motif_statut='LPA incomplète')
        [t] = [t for t in self._resultats() if t['type'] == 'ssdgps']
        self.assertTrue(t['renvoye'])
        self.assertEqual(t['motif'], 'LPA incomplète')
        self.assertEqual(t['a_faire'], 'Corriger selon le motif du renvoi')

    def test_niveaux_incomplets(self):
        Projet.objects.create(nom_projet='Vide', code_projet='P-VIDE', organization=self.org, created_by=self.moi)
        _, _, aff, _ = self._hierarchie(self.moi, 'P-2', avec_ssdgps=False)
        types = {t['type']: t for t in self._resultats()}
        self.assertEqual(types['projet']['a_faire'], 'Ajouter une propriété')
        self.assertEqual(types['affaire']['id'], str(aff.id))
        self.assertEqual(types['affaire']['a_faire'], 'Créer le SDGPS')
        self.assertNotIn('propriete', types)               # elle a une affaire

    def test_projet_cloture_et_corbeille_exclus(self):
        Projet.objects.create(nom_projet='Clos', code_projet='P-C', organization=self.org,
                              created_by=self.moi, statut='cloture')
        projet, _, _, ss = self._hierarchie(self.moi)
        Projet.objects.filter(pk=projet.pk).update(is_deleted=True)
        self.assertEqual(self._resultats(), [])

    def test_rapport_en_cours_et_echec_rattrape(self):
        _, _, _, ss = self._hierarchie(self.moi)
        Ssdgps.objects.filter(pk=ss.pk).update(statut='valide')          # dossier lui-même terminé
        g = RapportGeneration.objects.create(ssdgps=ss, created_by=self.moi, statut='en_cours', progression=40)
        [t] = self._resultats()
        self.assertEqual((t['type'], t['id'], t['progression_pct']), ('rapport', str(g.id), 40))
        self.assertTrue(t['lien'].endswith('&rapport=1'))
        RapportGeneration.objects.filter(pk=g.pk).update(statut='echec')
        self.assertEqual(self._resultats()[0]['a_faire'], 'Relancer la génération')
        RapportGeneration.objects.create(ssdgps=ss, created_by=self.moi, statut='termine')
        self.assertEqual(self._resultats(), [])                            # échec rattrapé

    def test_rbac_hors_organisation(self):
        autre = Organization.objects.create(code='ORG-Z', name='Autre')
        intrus = self._membre('intrus@z.ma', autre)
        _, _, _, ss = self._hierarchie(self.moi)
        # Même s'il a touché une pièce, un dossier hors de sa portée n'apparaît pas.
        Piece.objects.create(ssdgps=ss, type_piece='LPA', created_by=intrus)
        self.client.force_authenticate(intrus)
        self.assertEqual(self._resultats(), [])

    def test_limite(self):
        for i in range(4):
            self._hierarchie(self.moi, f'P-{i}')
        resp = self.client.get(URL, {'limite': 2})
        self.assertEqual(len(resp.data['resultats']), 2)
        self.assertEqual(resp.data['total'], 4)
