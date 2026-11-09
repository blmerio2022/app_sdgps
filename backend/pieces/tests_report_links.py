"""
Liens cliquables de la page de garde vers les pièces du rapport PDF.

Le gabarit pose depuis toujours, sur le n° d'ordre et la désignation de chaque ligne de
la page de garde, un lien `href="#piece-k"` visant l'`id` de la page-séparateur. Ces
liens étaient pourtant **inertes** : chaque pièce est rendue comme un document WeasyPrint
SÉPARÉ (indispensable pour que « PAGE N°k » reparte de 1 à chaque pièce), si bien que la
cible ne se trouve jamais dans le même document que le lien. Le PDF contenait donc des
annotations `/Link` avec une destination NOMMÉE (`/Dest: piece-k`) et une table de
destinations nommées **vide** — cliquer ne faisait rien.

`report._resolve_piece_links` remplace, après assemblage, chaque destination nommée par
une destination explicite pointant la page réelle du séparateur.

Ces tests rendent de vrais PDF (WeasyPrint) : le rendu est mutualisé par classe pour
rester rapide.
"""
import re
from datetime import datetime, timezone as dt_timezone
from io import BytesIO

from django.contrib.auth import get_user_model
from django.test import TestCase
from pypdf import PdfReader

from accounts.models import Membership, Organization
from pieces.models import Piece
from pieces.report import render_report_pdf, _resolve_piece_links
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()


class LiensPageDeGardeTests(TestCase):
    """Rend le rapport une seule fois par mode d'impression (rendu WeasyPrint coûteux)."""

    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(code='ORG-L', name='Org Liens')
        user = User.objects.create_user(username='l@sdgps.ma', email='l@sdgps.ma',
                                        password='Passw0rd!')
        Membership.objects.create(user=user, organization=org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-L-1',
                                       organization=org, created_by=user)
        propriete = Propriete.objects.create(nom_propriete='X', id_titre='T9000/A',
                                             projet=projet)
        affaire = Affaire.objects.create(
            numero_sd_affaire=1, nature_procedure_affaire='IFF', nature_affaire='BI',
            date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
            propriete=propriete)
        cls.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                           type_ssdgps='multi-session', affaire=affaire)
        cls.pieces = [
            Piece.objects.create(ssdgps=cls.ssdgps, type_piece=type_piece, numero=1,
                                 statut='valide', ordre=ordre, source_saisie='manuel',
                                 payload={'rows': []}, created_by=user)
            for ordre, type_piece in enumerate(('LPA', 'ROB'))
        ]
        cls._cache = {}

    def _rapport(self, duplex=False):
        if duplex not in self._cache:
            octets = render_report_pdf(self.ssdgps, None, self.pieces, duplex=duplex)
            self._cache[duplex] = PdfReader(BytesIO(octets))
        return self._cache[duplex]

    @staticmethod
    def _liens_page_de_garde(lecteur):
        """[(destination, index de page cible ou None)] pour la page de garde."""
        par_idnum = {p.indirect_reference.idnum: i for i, p in enumerate(lecteur.pages)}
        liens = []
        for annot in lecteur.pages[0].get('/Annots') or []:
            objet = annot.get_object()
            if objet.get('/Subtype') != '/Link':
                continue
            dest = objet.get('/Dest')
            if isinstance(dest, str):
                liens.append((dest, None))              # destination NOMMÉE = non résolue
            else:
                liens.append((dest, par_idnum.get(dest[0].idnum)))
        return liens

    @staticmethod
    def _page_de_piece(lecteur, numero):
        """Index de la page-séparateur portant « PIÈCE N°<numero> : »."""
        motif = re.compile(rf'PIÈCE N°{numero}\s*:')
        for i, page in enumerate(lecteur.pages):
            texte = page.extract_text() or ''
            # Le séparateur porte le titre en grand ; les pages de contenu aussi dans
            # leur en-tête, mais le séparateur vient toujours en premier.
            if motif.search(texte):
                return i
        return None

    # --- le défaut corrigé ------------------------------------------------

    def test_aucun_lien_ne_reste_une_destination_nommee(self):
        """Le symptôme d'origine : des `/Dest` nommés que rien ne résolvait."""
        for dest, _cible in self._liens_page_de_garde(self._rapport()):
            self.assertNotIsInstance(
                dest, str, f'destination nommée non résolue : {dest}')

    def test_un_lien_par_colonne_cliquable_et_par_piece(self):
        """N° d'ordre ET désignation sont cliquables → 2 liens par pièce."""
        liens = self._liens_page_de_garde(self._rapport())
        self.assertEqual(len(liens), 2 * len(self.pieces))

    def test_chaque_lien_vise_la_page_separateur_de_sa_piece(self):
        lecteur = self._rapport()
        cibles = [cible for _dest, cible in self._liens_page_de_garde(lecteur)]
        for numero in (1, 2):
            attendu = self._page_de_piece(lecteur, numero)
            self.assertIsNotNone(attendu, f'séparateur de la pièce {numero} introuvable')
            # Les deux liens de la pièce pointent la même page.
            self.assertEqual(cibles.count(attendu), 2,
                             f'pièce {numero} : 2 liens attendus vers la page {attendu}')

    def test_les_liens_ne_visent_jamais_la_page_de_garde(self):
        """Un lien resté sur la page 0 signalerait une résolution ratée."""
        for _dest, cible in self._liens_page_de_garde(self._rapport()):
            self.assertNotEqual(cible, 0)

    # --- recto-verso ------------------------------------------------------

    def test_les_pages_blanches_de_calage_sont_prises_en_compte(self):
        """En recto-verso, des pages blanches décalent les pièces : les liens doivent
        suivre ce décalage, pas les index du mode recto seul."""
        simple, duplex = self._rapport(False), self._rapport(True)
        self.assertGreater(len(duplex.pages), len(simple.pages))  # calage inséré

        cibles_duplex = [c for _d, c in self._liens_page_de_garde(duplex)]
        for numero in (1, 2):
            attendu = self._page_de_piece(duplex, numero)
            self.assertEqual(cibles_duplex.count(attendu), 2)

    def test_destination_conserve_le_zoom_du_lecteur(self):
        """`/XYZ` avec des valeurs nulles = aller en haut de la page sans changer le
        zoom — comportement attendu d'un « aller à la pièce » (et non `/Fit`, qui
        recadrerait la page entière)."""
        dest, _cible = self._liens_page_de_garde(self._rapport())[0]
        self.assertEqual(str(dest[1]), '/XYZ')

    # --- robustesse de la résolution --------------------------------------

    def test_resolution_sans_correspondance_ne_fait_rien(self):
        """Table vide : la fonction sort sans toucher au document."""
        from pypdf import PdfWriter
        writer = PdfWriter()
        self.assertEqual(_resolve_piece_links(writer, {}), 0)

    def test_resolution_ignore_un_numero_de_page_hors_bornes(self):
        """Garde-fou : une correspondance incohérente ne doit pas produire un lien
        pointant une page inexistante (PDF corrompu)."""
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.append(self._rapport())
        self.assertEqual(_resolve_piece_links(writer, {1: 10_000}), 0)
