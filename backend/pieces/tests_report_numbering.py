"""
Numérotation des pièces et colonne « Page » de la page de garde.

Deux règles métier, toutes deux visibles sur la page de garde :

1. **Numéro composé en synthèse.** Dans un rapport couvrant plusieurs sessions, une pièce
   déclinée par session porte le numéro ``<n° de session>/<n° de pièce>`` — « 1/3 »,
   « 2/3 », « 3/3 » pour les trois sessions de la pièce n°3. Le numéro de pièce est celui
   de la **pièce logique** : toutes ses sessions le partagent, puisque c'est la même pièce.
   Hors synthèse, rien ne change : « 3 ».

2. **Colonne « Page ».** Le tableau de la page de garde indique, pour chaque pièce, son
   numéro de page GLOBAL dans le rapport assemblé — le même que celui imprimé en bas de
   page (« Page i/n »). La page de garde devient ainsi un véritable sommaire.
"""
import re
from datetime import datetime, timezone as dt_timezone
from io import BytesIO

from django.contrib.auth import get_user_model
from django.test import TestCase
from pypdf import PdfReader

from accounts.models import Membership, Organization
from pieces.models import Piece
from pieces.report import (build_report_context, order_pieces_for_synthesis,
                           piece_numbers, render_report_pdf)
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()


class PieceNumbersTests(TestCase):
    """Le calcul du numéro affiché, isolé de tout rendu."""

    def test_hors_synthese_le_numero_est_celui_de_la_piece(self):
        self.assertEqual(piece_numbers(3), ('3', '03'))

    def test_en_synthese_le_numero_est_session_sur_piece(self):
        self.assertEqual(piece_numbers(3, 1), ('1/3', '1/3'))
        self.assertEqual(piece_numbers(3, 2), ('2/3', '2/3'))

    def test_la_page_de_garde_garde_ses_deux_chiffres_hors_synthese(self):
        """La colonne « N° Ordre » est historiquement remplie sur deux chiffres."""
        self.assertEqual(piece_numbers(1)[1], '01')

    def test_le_numero_compose_n_est_pas_complete_de_zeros(self):
        """« 1/03 » n'aurait aucun sens : le zéro de tête ne vaut que pour un numéro nu."""
        self.assertEqual(piece_numbers(3, 1)[1], '1/3')

    def test_numero_de_session_a_deux_chiffres(self):
        self.assertEqual(piece_numbers(12, 10), ('10/12', '10/12'))


class CercleNumeroComposeTests(TestCase):
    """Le cercle d'en-tête porte « PIÈCE N°<numéro> ». Un numéro composé (« 1/2 ») est
    deux caractères plus long que la forme simple et débordait du cercle : il reçoit une
    classe `c-long` qui réduit la police. Rendu du seul gabarit, sans base de données."""

    HEADER = {'organisme_niveau1': 'ANCFCC', 'organisme_niveau2': 'SERVICE',
              'propriete': 'X', 'requisition': 'R1', 'titre': '', 'nature_affaire': 'BI',
              'nature_ssdgps': 'PDC/GPS', 'numero_ssdgps': 2, 'session_numero': None,
              'session_date': '', 'session_label': '', 'projet': 'P'}

    def _html(self, numero):
        from django.template.loader import render_to_string
        return render_to_string('pieces/report.html', {
            'header': self.HEADER, 'mode': 'piece', 'foot_prefix': 'X', 'duplex': False,
            'piece': {'index': 2, 'numero': numero, 'title': 'T', 'code': 'ROB',
                      'content_landscape': False, 'session_numero': None,
                      'session_label': '',
                      'content': {'kind': 'empty', 'tables': [], 'images': [],
                                  'photos': [], 'blocks': [], 'versions': []}}})

    def test_numero_compose_reduit_la_police(self):
        self.assertIn('c-bot c-long', self._html('1/2'))

    def test_numero_simple_garde_la_police_d_origine(self):
        # On vise le BALISAGE, pas la feuille de style : `c-long` y est toujours déclaré.
        self.assertNotIn('c-bot c-long', self._html('12'))
        self.assertIn('class="c-half c-bot"', self._html('12'))


class NumerotationBaseTest(TestCase):
    """SSDGPS à 3 sessions, 1 pièce commune et 2 pièces déclinées par session."""

    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(code='ORG-NU', name='Org Numérotation')
        cls.user = User.objects.create_user(username='nu@sdgps.ma', email='nu@sdgps.ma',
                                            password='Passw0rd!')
        Membership.objects.create(user=cls.user, organization=cls.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-NU-1',
                                       organization=cls.org, created_by=cls.user)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9000/A',
                                             projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
            propriete=propriete)
        cls.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                           type_ssdgps='multi-session', affaire=affaire)
        cls.sessions = [
            Session.objects.update_or_create(
                ssdgps=cls.ssdgps, numero_session=n,
                defaults={'date_session': datetime(2024, 1, 10 + n,
                                                   tzinfo=dt_timezone.utc)})[0]
            for n in (1, 2, 3)
        ]
        cls.commune = cls._piece('LPA', None, 0)
        cls.rob = [cls._piece('ROB', s, 1 + i) for i, s in enumerate(cls.sessions)]
        cls.rtlb = [cls._piece('RTLB', s, 4 + i) for i, s in enumerate(cls.sessions)]

    @classmethod
    def _piece(cls, type_piece, session, ordre, numero=1):
        return Piece.objects.create(
            ssdgps=cls.ssdgps, session=session, type_piece=type_piece, numero=numero,
            statut='valide', ordre=ordre, source_saisie='manuel',
            payload={'rows': []}, created_by=cls.user)

    def _contexte_synthese(self):
        pieces = order_pieces_for_synthesis(
            [self.commune, *self.rob, *self.rtlb])
        return build_report_context(self.ssdgps, None, pieces)


class NumerotationSyntheseTests(NumerotationBaseTest):

    def test_les_sessions_d_une_piece_partagent_son_numero(self):
        """Le cas décrit par le métier : 1/2, 2/2, 3/2 pour les 3 sessions de la pièce 2."""
        ctx = self._contexte_synthese()
        self.assertEqual([p['numero'] for p in ctx['pieces']],
                         ['1', '1/2', '2/2', '3/2', '1/3', '2/3', '3/3'])

    def test_la_piece_commune_n_est_pas_prefixee_d_une_session(self):
        """Elle vaut pour TOUTES les sessions : lui coller « 1/ » serait faux."""
        ctx = self._contexte_synthese()
        self.assertEqual(ctx['pieces'][0]['numero'], '1')

    def test_le_numero_de_piece_ne_saute_pas_de_valeur(self):
        """3 pièces logiques → les numéros 1, 2, 3, et non 1..7 (un par occurrence)."""
        ctx = self._contexte_synthese()
        numeros = {p['numero'].split('/')[-1] for p in ctx['pieces']}
        self.assertEqual(numeros, {'1', '2', '3'})

    def test_l_index_interne_reste_unique(self):
        """Les occurrences partagent leur numéro AFFICHÉ mais pas leur index : c'est lui
        qui ancre le lien cliquable vers la bonne page-séparateur."""
        ctx = self._contexte_synthese()
        index = [p['index'] for p in ctx['pieces']]
        self.assertEqual(index, list(range(1, 8)))

    def test_la_page_de_garde_affiche_le_meme_numero(self):
        ctx = self._contexte_synthese()
        self.assertEqual([r['numero'] for r in ctx['cover_rows']],
                         ['01', '1/2', '2/2', '3/2', '1/3', '2/3', '3/3'])

    def test_deux_numeros_de_piece_distincts_pour_un_meme_type(self):
        """« Rapport de la détermination N°1 » et « N°2 » sont deux pièces logiques."""
        rdn1 = self._piece('RDN', self.sessions[0], 10, numero=1)
        rdn2 = self._piece('RDN', self.sessions[0], 11, numero=2)
        pieces = order_pieces_for_synthesis([*self.rob, rdn1, rdn2])
        ctx = build_report_context(self.ssdgps, None, pieces)
        self.assertEqual([p['numero'] for p in ctx['pieces']],
                         ['1/1', '2/1', '3/1', '1/2', '1/3'])


class NumerotationMonoSessionTests(NumerotationBaseTest):
    """Hors synthèse, la numérotation d'origine est strictement préservée."""

    def test_numerotation_sequentielle_simple(self):
        pieces = [self.commune, self.rob[0], self.rtlb[0]]
        ctx = build_report_context(self.ssdgps, self.sessions[0], pieces)
        self.assertEqual([p['numero'] for p in ctx['pieces']], ['1', '2', '3'])
        self.assertEqual([r['numero'] for r in ctx['cover_rows']], ['01', '02', '03'])

    def test_deux_pieces_de_meme_type_restent_numerotees_a_part(self):
        """Hors synthèse, aucun regroupement : deux pièces du même type et du même numéro
        gardent deux numéros distincts (le regroupement n'a de sens qu'entre sessions)."""
        a = self._piece('RDC', None, 20, numero=1)
        b = self._piece('RDC', None, 21, numero=1)
        ctx = build_report_context(self.ssdgps, self.sessions[0], [a, b])
        self.assertEqual([p['numero'] for p in ctx['pieces']], ['1', '2'])


class ColonnePageTests(NumerotationBaseTest):
    """La colonne « Page » de la page de garde, vérifiée sur un PDF réellement rendu.

    Le rendu WeasyPrint est coûteux : un seul par mode d'impression, mis en cache.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls._cache = {}

    def _rapport(self, duplex=False):
        if duplex not in self._cache:
            octets = render_report_pdf(self.ssdgps, self.sessions[0],
                                       [self.commune, self.rob[0], self.rtlb[0]],
                                       duplex=duplex)
            self._cache[duplex] = PdfReader(BytesIO(octets))
        return self._cache[duplex]

    @staticmethod
    def _pages_annoncees(lecteur):
        """{n° de pièce: n° de page annoncé} lu dans le tableau de la page de garde."""
        texte = lecteur.pages[0].extract_text() or ''
        annonces = {}
        for ligne in texte.splitlines():
            trouve = re.match(r'\s*(\d{2})\s+.*?\s(\d+)\s+\.\.\.', ligne)
            if trouve:
                annonces[int(trouve.group(1))] = int(trouve.group(2))
        return annonces

    @staticmethod
    def _page_reelle(lecteur, numero):
        """N° de page (1-based) de la page-séparateur « PIÈCE N°<numero> »."""
        motif = re.compile(rf'PIÈCE N°{numero}\s*:')
        for i, page in enumerate(lecteur.pages, start=1):
            if motif.search(page.extract_text() or ''):
                return i
        return None

    def test_la_colonne_page_existe(self):
        self.assertIn('Page', self._rapport().pages[0].extract_text())

    def test_chaque_piece_annonce_sa_vraie_page(self):
        lecteur = self._rapport()
        annonces = self._pages_annoncees(lecteur)
        self.assertEqual(len(annonces), 3, f'3 lignes attendues, lu : {annonces}')
        for numero, page in annonces.items():
            self.assertEqual(page, self._page_reelle(lecteur, numero),
                             f'pièce {numero} : page annoncée {page}')

    def test_les_pages_annoncees_sont_croissantes(self):
        annonces = self._pages_annoncees(self._rapport())
        valeurs = [annonces[k] for k in sorted(annonces)]
        self.assertEqual(valeurs, sorted(valeurs))

    def test_aucune_piece_annoncee_en_page_1(self):
        """La page 1 est la page de garde : y renvoyer trahirait un décalage."""
        for page in self._pages_annoncees(self._rapport()).values():
            self.assertGreater(page, 1)

    def test_les_pages_blanches_de_calage_sont_comptees(self):
        """En recto-verso, des pages blanches décalent les pièces : la colonne doit les
        compter, sans quoi elle désignerait la page précédente."""
        lecteur = self._rapport(duplex=True)
        for numero, page in self._pages_annoncees(lecteur).items():
            self.assertEqual(page, self._page_reelle(lecteur, numero),
                             f'pièce {numero} (recto-verso) : page annoncée {page}')
