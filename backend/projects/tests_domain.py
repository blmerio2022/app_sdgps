"""
Tests du domaine métier (Phase 5) : validations conditionnelles + scoping RBAC.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Organization, Membership
from organismes.models import OrganismeNiveau1, OrganismeNiveau2
from projects.models import Projet, Propriete, Affaire, Ssdgps, Session

User = get_user_model()


def make_agent(email, org):
    u = User.objects.create_user(username=email, email=email, password='Passw0rd!')
    Membership.objects.create(user=u, organization=org, role='ROLE_ORGANISATION_AGENT')
    return u


class DomainBaseTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org1 = Organization.objects.create(code='ORG-1', name='Org 1')
        self.org2 = Organization.objects.create(code='ORG-2', name='Org 2')
        self.agent1 = make_agent('a1@example.com', self.org1)
        self.agent2 = make_agent('a2@example.com', self.org2)
        self.client.force_authenticate(self.agent1)
        # Organismes (obligatoires à la création d'une propriété via l'API).
        self.on1 = OrganismeNiveau1.objects.create(code='ON1', nom='Organisme N1')
        self.on2 = OrganismeNiveau2.objects.create(code='ON2', nom='Organisme N2', niveau1=self.on1)

    def _projet(self, org=None, code='P-1', created_by=None):
        return Projet.objects.create(
            nom_projet='Projet', code_projet=code,
            organization=org or self.org1, created_by=created_by or self.agent1,
        )

    def _propriete(self, projet=None):
        return Propriete.objects.create(
            nom_propriete='AMADLE 0', id_requisition='R19000/55',
            projet=projet or self._projet(),
        )

    def _affaire(self, propriete=None):
        return Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage='2023-04-09', propriete=propriete or self._propriete(),
        )

    def _ssdgps(self, affaire=None, numero=1):
        return Ssdgps.objects.create(
            nature_ssdgps='PDC/GPS', numero_ssdgps=numero,
            type_ssdgps='multi-session', affaire=affaire or self._affaire(),
        )


class ProprieteValidationTests(DomainBaseTest):
    def test_requires_requisition_or_titre(self):
        projet = self._projet()
        resp = self.client.post('/api/v1/proprietes/', {
            'nom_propriete': 'Sans id', 'projet': str(projet.id),
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_requisition_format_rejected(self):
        projet = self._projet()
        resp = self.client.post('/api/v1/proprietes/', {
            'nom_propriete': 'X', 'id_requisition': 'XYZ', 'projet': str(projet.id),
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_valid_requisition_accepted(self):
        projet = self._projet()
        resp = self.client.post('/api/v1/proprietes/', {
            'nom_propriete': 'AMADLE 0', 'id_requisition': 'R19000/55', 'projet': str(projet.id),
            'organisme_niveau1': str(self.on1.id), 'organisme_niveau2': str(self.on2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)


class ProprieteIdentifierTests(DomainBaseTest):
    """`id_propriete` : titre foncier prioritaire, repli sur la réquisition."""

    def _get(self, **over):
        champs = {'nom_propriete': 'AMADLE 0', 'id_requisition': '', 'id_titre': ''}
        champs.update(over)
        propriete = Propriete.objects.create(projet=self._projet(), **champs)
        resp = self.client.get(f'/api/v1/proprietes/{propriete.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_titre_prioritaire_sur_requisition(self):
        data = self._get(id_titre='T12345/A', id_requisition='R19000/55')
        self.assertEqual(data['id_propriete'], 'T12345/A')

    def test_repli_sur_requisition_sans_titre(self):
        data = self._get(id_requisition='R19000/55')
        self.assertEqual(data['id_propriete'], 'R19000/55')

    def test_vide_si_aucun_identifiant(self):
        # Cas legacy (données créées hors API) : le champ est présent mais vide, jamais absent.
        data = self._get()
        self.assertEqual(data['id_propriete'], '')

    def test_champ_en_lecture_seule(self):
        """`id_propriete` est dérivé : l'envoyer ne doit pas être persisté ni faire échouer."""
        projet = self._projet()
        resp = self.client.post('/api/v1/proprietes/', {
            'nom_propriete': 'AMADLE 0', 'id_requisition': 'R19000/55', 'projet': str(projet.id),
            'organisme_niveau1': str(self.on1.id), 'organisme_niveau2': str(self.on2.id),
            'id_propriete': 'T99999/Z',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['id_propriete'], 'R19000/55')


class AffaireCoherenceTests(DomainBaseTest):
    def _post(self, **over):
        propriete = self._propriete()
        data = {
            'numero_sd_affaire': 1, 'nature_procedure_affaire': 'IFF',
            'nature_affaire': 'BI', 'date_bornage': '2023-04-09',
            'propriete': str(propriete.id),
        }
        data.update(over)
        return self.client.post('/api/v1/affaires/', data, format='json')

    def test_nature_incompatible_with_procedure(self):
        resp = self._post(nature_affaire='RB')  # RB invalide pour IFF
        self.assertEqual(resp.status_code, 400)

    def test_iff_requires_date_bornage(self):
        resp = self._post(date_bornage=None)
        self.assertEqual(resp.status_code, 400)

    def test_ife_forbids_date_bornage(self):
        resp = self._post(nature_procedure_affaire='IFE', nature_affaire='IFE',
                          date_bornage='2023-04-09')
        self.assertEqual(resp.status_code, 400)

    def test_ife_without_date_ok(self):
        resp = self._post(nature_procedure_affaire='IFE', nature_affaire='IFE', date_bornage=None)
        self.assertEqual(resp.status_code, 201, resp.content)


class SsdgpsSessionTests(DomainBaseTest):
    def test_mono_session_autocreates_one_session(self):
        affaire = self._affaire()
        resp = self.client.post('/api/v1/ssdgps/', {
            'nature_ssdgps': 'PDC/GPS', 'numero_ssdgps': 1,
            'type_ssdgps': 'mono-session', 'affaire': str(affaire.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        ss = Ssdgps.objects.get(pk=resp.json()['id'])
        self.assertEqual(ss.sessions.count(), 1)
        self.assertEqual(ss.sessions.first().numero_session, 1)

    def test_multi_session_no_autocreate(self):
        affaire = self._affaire()
        resp = self.client.post('/api/v1/ssdgps/', {
            'nature_ssdgps': 'DDC/GPS', 'numero_ssdgps': 2,
            'type_ssdgps': 'multi-session', 'affaire': str(affaire.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        ss = Ssdgps.objects.get(pk=resp.json()['id'])
        self.assertEqual(ss.sessions.count(), 0)

    def test_unique_numero_ssdgps_per_affaire(self):
        affaire = self._affaire()
        payload = {'nature_ssdgps': 'PDC/GPS', 'numero_ssdgps': 1,
                   'type_ssdgps': 'mono-session', 'affaire': str(affaire.id)}
        self.assertEqual(self.client.post('/api/v1/ssdgps/', payload, format='json').status_code, 201)
        self.assertEqual(self.client.post('/api/v1/ssdgps/', payload, format='json').status_code, 400)


class RbacScopingTests(DomainBaseTest):
    def test_agent_sees_only_own_org_projects(self):
        self._projet(org=self.org1, code='P-ORG1')
        # Projet d'une autre org créé par un AUTRE utilisateur → invisible.
        self._projet(org=self.org2, code='P-ORG2', created_by=self.agent2)
        resp = self.client.get('/api/v1/projets/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        data = data.get('results', data) if isinstance(data, dict) else data
        codes = {p['code_projet'] for p in data}
        self.assertIn('P-ORG1', codes)
        self.assertNotIn('P-ORG2', codes)

    def test_agent_sees_own_projects_even_in_foreign_org(self):
        """Les projets « suivent » leur créateur : agent1 voit un projet qu'il a créé,
        même s'il est rattaché à une organisation dont il n'est pas (ou plus) membre —
        cas d'un changement d'organisation."""
        self._projet(org=self.org2, code='P-MINE', created_by=self.agent1)
        resp = self.client.get('/api/v1/projets/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        data = data.get('results', data) if isinstance(data, dict) else data
        codes = {p['code_projet'] for p in data}
        self.assertIn('P-MINE', codes)

    def test_agent_project_forced_to_own_org(self):
        # Un projet appartient toujours à l'organisation courante de son créateur : si l'agent
        # tente d'imposer une organisation étrangère (org2), elle est forcée sur la sienne (org1).
        resp = self.client.post('/api/v1/projets/', {
            'nom_projet': 'X', 'code_projet': 'P-X', 'organization': str(self.org2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(Projet.objects.get(code_projet='P-X').organization_id, self.org1.id)

    def test_agent_creates_project_in_own_org(self):
        resp = self.client.post('/api/v1/projets/', {
            'nom_projet': 'X', 'code_projet': 'P-OK', 'organization': str(self.org1.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)


class RestoreTests(DomainBaseTest):
    """Suppression logique + restauration (unitaire et groupée), scopées par organisation."""

    def test_deleted_project_hidden_by_default_and_listed_with_show_deleted(self):
        p = self._projet(code='P-DEL')
        self.client.delete(f'/api/v1/projets/{p.id}/')

        resp = self.client.get('/api/v1/projets/')
        codes = {x['code_projet'] for x in resp.json().get('results', resp.json())} \
            if isinstance(resp.json(), dict) else {x['code_projet'] for x in resp.json()}
        self.assertNotIn('P-DEL', codes)

        resp2 = self.client.get('/api/v1/projets/?show_deleted=true')
        data2 = resp2.json()
        data2 = data2.get('results', data2) if isinstance(data2, dict) else data2
        codes2 = {x['code_projet'] for x in data2}
        self.assertIn('P-DEL', codes2)

    def test_restore_single_project(self):
        p = self._projet(code='P-RESTORE')
        self.client.delete(f'/api/v1/projets/{p.id}/')

        resp = self.client.post(f'/api/v1/projets/{p.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        p.refresh_from_db()
        self.assertFalse(p.is_deleted)
        self.assertIsNone(p.deleted_at)

    def test_bulk_restore_projects(self):
        p1 = self._projet(code='P-BULK1')
        p2 = self._projet(code='P-BULK2')
        self.client.delete(f'/api/v1/projets/{p1.id}/')
        self.client.delete(f'/api/v1/projets/{p2.id}/')

        resp = self.client.post('/api/v1/projets/bulk-restore/', {'ids': [str(p1.id), str(p2.id)]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['restored_count'], 2)
        p1.refresh_from_db(); p2.refresh_from_db()
        self.assertFalse(p1.is_deleted)
        self.assertFalse(p2.is_deleted)

    def test_cannot_restore_project_of_foreign_org(self):
        # Projet d'une autre org créé par un AUTRE utilisateur → hors périmètre : 404.
        foreign = self._projet(org=self.org2, code='P-FOREIGN', created_by=self.agent2)
        foreign.is_deleted = True
        foreign.save(update_fields=['is_deleted'])

        resp = self.client.post(f'/api/v1/projets/{foreign.id}/restore/')
        self.assertEqual(resp.status_code, 404)


class AggregateCountsTests(DomainBaseTest):
    """Compteurs `nbr_total_*` annotés au niveau du queryset, à chaque niveau."""

    def setUp(self):
        super().setUp()
        self.projet = self._projet(code='P-COUNTS')
        self.propriete = self._propriete(projet=self.projet)
        self.affaire = self._affaire(propriete=self.propriete)
        # Ssdgps en multi-session : pas de session auto-créée, on en ajoute 2 manuellement.
        self.ssdgps = self._ssdgps(affaire=self.affaire, numero=1)
        Session.objects.create(ssdgps=self.ssdgps, numero_session=1, date_session='2023-04-09')
        Session.objects.create(ssdgps=self.ssdgps, numero_session=2, date_session='2023-04-10')
        # Un 2e SSDGPS avec une session supprimée : ne doit pas être compté.
        self.ssdgps2 = self._ssdgps(affaire=self.affaire, numero=2)
        deleted_session = Session.objects.create(
            ssdgps=self.ssdgps2, numero_session=1, date_session='2023-04-09',
        )
        deleted_session.is_deleted = True
        deleted_session.save(update_fields=['is_deleted'])

    def test_projet_counts(self):
        resp = self.client.get(f'/api/v1/projets/{self.projet.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['nbr_total_proprietes'], 1)
        self.assertEqual(data['nbr_total_affaires'], 1)
        self.assertEqual(data['nbr_total_ssdgps'], 2)
        self.assertEqual(data['nbr_total_sessions'], 2)

    def test_propriete_counts(self):
        resp = self.client.get(f'/api/v1/proprietes/{self.propriete.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['nbr_total_affaires'], 1)
        self.assertEqual(data['nbr_total_ssdgps'], 2)
        self.assertEqual(data['nbr_total_sessions'], 2)

    def test_affaire_counts(self):
        resp = self.client.get(f'/api/v1/affaires/{self.affaire.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['nbr_total_ssdgps'], 2)
        self.assertEqual(data['nbr_total_sessions'], 2)

    def test_propriete_and_affaire_expose_pieces_count(self):
        """`nbr_total_pieces` remonte aux niveaux propriété et affaire, en excluant les pièces
        supprimées. `self.ssdgps` a 2 sessions actives : ses 2 pièces communes comptent donc
        une fois par session (2 × 2 = 4). `self.ssdgps2` n'a aucune session active → 0."""
        from pieces.models import Piece
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps, source_saisie='manuel')
        Piece.objects.create(type_piece='PGSDGPS', ssdgps=self.ssdgps, source_saisie='manuel')
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps2, source_saisie='manuel')
        supprimee = Piece.objects.create(
            type_piece='PGSDGPS', ssdgps=self.ssdgps2, source_saisie='manuel')
        supprimee.is_deleted = True
        supprimee.save(update_fields=['is_deleted'])

        resp = self.client.get(f'/api/v1/proprietes/{self.propriete.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_pieces'], 4)

        resp = self.client.get(f'/api/v1/affaires/{self.affaire.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_pieces'], 4)

    def test_pieces_of_deleted_ssdgps_excluded(self):
        from pieces.models import Piece
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps, source_saisie='manuel')
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps2, source_saisie='manuel')
        self.ssdgps2.is_deleted = True
        self.ssdgps2.save(update_fields=['is_deleted'])

        # Reste la pièce commune de `self.ssdgps`, comptée sur chacune de ses 2 sessions.
        self.assertEqual(
            self.client.get(f'/api/v1/proprietes/{self.propriete.id}/').json()['nbr_total_pieces'], 2)
        self.assertEqual(
            self.client.get(f'/api/v1/affaires/{self.affaire.id}/').json()['nbr_total_pieces'], 2)

    def test_ssdgps_total_est_le_cumul_de_ses_sessions(self):
        """Règle métier : le total d'un SSDGPS est la SOMME des totaux de ses sessions, et
        chaque niveau supérieur somme ses enfants — tous statuts confondus."""
        from pieces.models import Piece
        s1, s2 = self.ssdgps.sessions.order_by('numero_session')
        # 1 pièce propre à s2 (rejetée) + 1 commune (brouillon) : les statuts ne filtrent rien.
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps, source_saisie='manuel',
                             session=s2, statut=Piece.Statut.REJETE)
        Piece.objects.create(type_piece='PGSDGPS', ssdgps=self.ssdgps, source_saisie='manuel',
                             statut=Piece.Statut.BROUILLON)

        totaux = {}
        for level, ident in (('sessions', s1.id), ('sessions', s2.id), ('ssdgps', self.ssdgps.id),
                             ('affaires', self.affaire.id), ('proprietes', self.propriete.id),
                             ('projets', self.projet.id)):
            resp = self.client.get(f'/api/v1/{level}/{ident}/')
            self.assertEqual(resp.status_code, 200, resp.content)
            totaux[(level, ident)] = resp.json()['nbr_total_pieces']

        cumul_sessions = totaux[('sessions', s1.id)] + totaux[('sessions', s2.id)]
        self.assertEqual(totaux[('sessions', s1.id)], 1)   # la commune seule
        self.assertEqual(totaux[('sessions', s2.id)], 2)   # commune + propre
        self.assertEqual(totaux[('ssdgps', self.ssdgps.id)], cumul_sessions)   # 3
        self.assertEqual(totaux[('affaires', self.affaire.id)], cumul_sessions)
        self.assertEqual(totaux[('proprietes', self.propriete.id)], cumul_sessions)
        self.assertEqual(totaux[('projets', self.projet.id)], cumul_sessions)

    def test_ssdgps_sans_session_active_totalise_zero(self):
        """Conséquence assumée de la règle « total = cumul des sessions » : sans session
        active, un SSDGPS n'a aucun rapport de session, donc un cumul nul — à tous les
        niveaux (cohérence verticale). `self.ssdgps2` n'a qu'une session supprimée."""
        from pieces.models import Piece
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps2, source_saisie='manuel')

        resp = self.client.get(f'/api/v1/ssdgps/{self.ssdgps2.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_pieces'], 0)

    def test_session_counts_include_common_ssdgps_pieces(self):
        """Une pièce de portée SSDGPS (`session` nulle) appartient au rapport de CHAQUE
        session : elle doit être comptée dans chacune, comme le fait la page des pièces."""
        from pieces.models import Piece
        s1, s2 = self.ssdgps.sessions.order_by('numero_session')
        Piece.objects.create(type_piece='RDC', ssdgps=self.ssdgps,
                             source_saisie='manuel', session=s2)      # propre à la session 2
        Piece.objects.create(type_piece='PGSDGPS', ssdgps=self.ssdgps,
                             source_saisie='manuel')                   # commune (portée SSDGPS)

        resp = self.client.get(f'/api/v1/sessions/{s2.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_pieces'], 2)  # 1 propre + 1 commune

        resp = self.client.get(f'/api/v1/sessions/{s1.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_pieces'], 1)  # la commune seule

    def test_session_counts_exclude_deleted_and_other_ssdgps_pieces(self):
        from pieces.models import Piece
        s1 = self.ssdgps.sessions.order_by('numero_session').first()
        commune_supprimee = Piece.objects.create(
            type_piece='RDC', ssdgps=self.ssdgps, source_saisie='manuel')
        commune_supprimee.is_deleted = True
        commune_supprimee.save(update_fields=['is_deleted'])
        # Pièce commune d'un AUTRE SSDGPS : ne doit pas fuiter dans les sessions de celui-ci.
        Piece.objects.create(type_piece='PGSDGPS', ssdgps=self.ssdgps2, source_saisie='manuel')

        resp = self.client.get(f'/api/v1/sessions/{s1.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_pieces'], 0)

    def test_propriete_without_pieces_reports_zero(self):
        self.assertEqual(
            self.client.get(f'/api/v1/proprietes/{self.propriete.id}/').json()['nbr_total_pieces'], 0)
        self.assertEqual(
            self.client.get(f'/api/v1/affaires/{self.affaire.id}/').json()['nbr_total_pieces'], 0)

    def test_ssdgps_counts(self):
        resp = self.client.get(f'/api/v1/ssdgps/{self.ssdgps.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_sessions'], 2)

        resp2 = self.client.get(f'/api/v1/ssdgps/{self.ssdgps2.id}/')
        self.assertEqual(resp2.json()['nbr_total_sessions'], 0)

    def test_deleted_propriete_excluded_from_projet_counts(self):
        extra = self._propriete(projet=self.projet)
        extra.is_deleted = True
        extra.save(update_fields=['is_deleted'])

        resp = self.client.get(f'/api/v1/projets/{self.projet.id}/')
        self.assertEqual(resp.json()['nbr_total_proprietes'], 1)

    def test_restore_response_includes_counts(self):
        """Le sérialiseur de restore doit lire les compteurs sans planter (queryset annoté)."""
        self.projet.is_deleted = True
        self.projet.save(update_fields=['is_deleted'])

        resp = self.client.post(f'/api/v1/projets/{self.projet.id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['nbr_total_proprietes'], 1)


class CumulPiecesCorbeilleTests(DomainBaseTest):
    """Le cumul des pièces ignore TOUT ce qui est en corbeille : la pièce elle-même, ou
    n'importe quel palier au-dessus d'elle (session / SSDGPS / affaire / propriété)."""

    def setUp(self):
        super().setUp()
        from pieces.models import Piece
        self.projet = self._projet(code='P-CORBEILLE')
        self.propriete = self._propriete(projet=self.projet)
        self.affaire = self._affaire(propriete=self.propriete)
        self.ssdgps = self._ssdgps(affaire=self.affaire, numero=1)  # multi-session
        self.s1 = Session.objects.create(ssdgps=self.ssdgps, numero_session=1)
        self.s2 = Session.objects.create(ssdgps=self.ssdgps, numero_session=2)
        # 1 pièce commune (dans le rapport des 2 sessions) + 1 propre à la session 1.
        self.commune = Piece.objects.create(
            type_piece='PGSDGPS', ssdgps=self.ssdgps, source_saisie='manuel')
        self.propre = Piece.objects.create(
            type_piece='RDC', ssdgps=self.ssdgps, source_saisie='manuel', session=self.s1)

    def _totaux(self):
        """Total de pièces à chaque niveau, tel qu'exposé par l'API."""
        cibles = {
            'session1': f'sessions/{self.s1.id}', 'session2': f'sessions/{self.s2.id}',
            'ssdgps': f'ssdgps/{self.ssdgps.id}', 'affaire': f'affaires/{self.affaire.id}',
            'propriete': f'proprietes/{self.propriete.id}', 'projet': f'projets/{self.projet.id}',
        }
        totaux = {}
        for nom, chemin in cibles.items():
            resp = self.client.get(f'/api/v1/{chemin}/?show_deleted=true')
            if resp.status_code != 200:  # l'élément est actif → sans le filtre corbeille
                resp = self.client.get(f'/api/v1/{chemin}/')
            self.assertEqual(resp.status_code, 200, resp.content)
            totaux[nom] = resp.json()['nbr_total_pieces']
        return totaux

    @staticmethod
    def _corbeille(instance):
        instance.is_deleted = True
        instance.save(update_fields=['is_deleted'])

    def test_etat_initial(self):
        t = self._totaux()
        self.assertEqual(t['session1'], 2)   # commune + propre
        self.assertEqual(t['session2'], 1)   # commune seule
        self.assertEqual(t['ssdgps'], 3)     # cumul des 2 sessions
        self.assertEqual((t['affaire'], t['propriete'], t['projet']), (3, 3, 3))

    def test_piece_en_corbeille_exclue(self):
        self._corbeille(self.commune)
        t = self._totaux()
        self.assertEqual((t['session1'], t['session2']), (1, 0))
        self.assertEqual((t['ssdgps'], t['affaire'], t['propriete'], t['projet']), (1, 1, 1, 1))

    def test_session_en_corbeille_exclue(self):
        """La session 1 en corbeille : ni sa pièce propre, ni sa part de la pièce commune."""
        self._corbeille(self.s1)
        t = self._totaux()
        self.assertEqual(t['session2'], 1)
        self.assertEqual((t['ssdgps'], t['affaire'], t['propriete'], t['projet']), (1, 1, 1, 1))

    def test_ssdgps_en_corbeille_exclu_des_niveaux_superieurs(self):
        self._corbeille(self.ssdgps)
        t = self._totaux()
        self.assertEqual((t['affaire'], t['propriete'], t['projet']), (0, 0, 0))

    def test_affaire_en_corbeille_exclue_des_niveaux_superieurs(self):
        self._corbeille(self.affaire)
        t = self._totaux()
        self.assertEqual((t['propriete'], t['projet']), (0, 0))

    def test_propriete_en_corbeille_exclue_du_projet(self):
        self._corbeille(self.propriete)
        self.assertEqual(self._totaux()['projet'], 0)


class AuditFieldsTests(DomainBaseTest):
    """`created_by`/`updated_by`/`deleted_by` (exposés en `_email`), sur create/update/delete/restore."""

    def test_projet_audit_fields_lifecycle(self):
        # Créé via l'API (et non l'ORM directement) pour que perform_create renseigne created_by.
        resp = self.client.post('/api/v1/projets/', {
            'nom_projet': 'X', 'code_projet': 'P-AUDIT', 'organization': str(self.org1.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        p_id = resp.json()['id']
        self.assertEqual(resp.json()['created_by_email'], 'a1@example.com')
        self.assertIsNone(resp.json().get('updated_by_email'))
        self.assertIsNone(resp.json().get('deleted_by_email'))

        resp = self.client.patch(f'/api/v1/projets/{p_id}/', {'nom_projet': 'Projet renommé'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['updated_by_email'], 'a1@example.com')

        self.client.delete(f'/api/v1/projets/{p_id}/')
        resp = self.client.get('/api/v1/projets/?show_deleted=true')
        data = resp.json()
        data = data.get('results', data) if isinstance(data, dict) else data
        deleted = next(x for x in data if x['code_projet'] == 'P-AUDIT')
        self.assertEqual(deleted['deleted_by_email'], 'a1@example.com')
        self.assertIsNotNone(deleted['deleted_at'])

        resp = self.client.post(f'/api/v1/projets/{p_id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json().get('deleted_by_email'))
        self.assertIsNone(resp.json()['deleted_at'])

    def test_propriete_audit_fields_lifecycle(self):
        projet = self._projet()
        resp = self.client.post('/api/v1/proprietes/', {
            'nom_propriete': 'AMADLE 0', 'id_requisition': 'R19000/55', 'projet': str(projet.id),
            'organisme_niveau1': str(self.on1.id), 'organisme_niveau2': str(self.on2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['created_by_email'], 'a1@example.com')
        propriete_id = resp.json()['id']

        self.client.delete(f'/api/v1/proprietes/{propriete_id}/')
        resp = self.client.post(f'/api/v1/proprietes/{propriete_id}/restore/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json().get('deleted_by_email'))
        self.assertIsNone(resp.json()['deleted_at'])
