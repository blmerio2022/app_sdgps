"""
Agencement de l'en-tête des PIÈCES dans le rapport PDF : couples « clé : valeur »
répartis en deux colonnes, et non-chevauchement avec le tableau de données.

Symptôme d'origine : sur les pièces à long intitulé (rapport de détermination libre,
rapport de détermination intermédiaire N°k), le tableau de données chevauchait
l'encadré d'en-tête des pages de contenu.

Cause RÉELLE, trouvée en inspectant l'arbre de boîtes WeasyPrint : la boîte de marge
``@top-center`` qui accueille l'en-tête courant n'avait **aucune largeur déclarée**,
contrairement à ``@bottom-center``. WeasyPrint la résolvait donc à **0 mm**, centrée sur
un point : l'encadré (200 mm en portrait, 287 mm en paysage) y débordait et empiétait
sur le contenu. Mesuré avant correctif : ``@top-center = 0.0 × 38.0 mm``.

Correctif en deux volets :
  1. largeur explicite sur ``@top-center`` (la cause géométrique) ;
  2. couples répartis en DEUX colonnes — 3 à gauche, 3 à droite — ce qui divise par deux
     la hauteur de l'encadré et redonne de la marge sous le plafond de 43 mm réservé par
     ``@page contenu``.

Aucune séparation visible n'est introduite : l'agencement n'a ni bordure ni fond.
"""
import re
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.template.loader import render_to_string
from django.test import TestCase

from accounts.models import Membership, Organization
from pieces.models import Piece
from pieces.report import build_report_context
from projects.models import Affaire, Projet, Propriete, Session, Ssdgps

User = get_user_model()

GABARIT = 'pieces/report.html'
PARTIEL = 'pieces/_info_pairs.html'


class EnteteDeuxColonnesBaseTest(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(code='ORG-H', name='Org Entête')
        self.user = User.objects.create_user(
            username='h@sdgps.ma', email='h@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-H-1',
                                       organization=self.org, created_by=self.user)
        propriete = Propriete.objects.create(nom_propriete='Ferme Zaytoun',
                                             id_titre='T9000/A',
                                             id_requisition='R20000/10', projet=projet)
        self.affaire = Affaire.objects.create(
            numero_sd_affaire=2, nature_procedure_affaire='IFF', nature_affaire='BC',
            date_bornage=datetime(2024, 2, 1, tzinfo=dt_timezone.utc),
            propriete=propriete)

    def _ssdgps(self, type_ssdgps='multi-session'):
        return Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=2,
                                     type_ssdgps=type_ssdgps, affaire=self.affaire)

    def _piece(self, ssdgps, type_piece='RDL'):
        return Piece.objects.create(ssdgps=ssdgps, type_piece=type_piece, numero=1,
                                    statut='valide', ordre=1, source_saisie='manuel',
                                    payload={'rows': []}, created_by=self.user)

    def _contexte(self, ssdgps, session=None):
        return build_report_context(ssdgps, session, [self._piece(ssdgps)])

    def _rendu_partiel(self, ssdgps, session=None, compact=False):
        ctx = self._contexte(ssdgps, session)
        return render_to_string(PARTIEL, {'header': ctx['header'], 'compact': compact})

    def _rendu_gabarit(self, mode, ssdgps, session=None):
        ctx = self._contexte(ssdgps, session)
        return render_to_string(GABARIT, {
            'header': ctx['header'], 'mode': mode, 'foot_prefix': '', 'duplex': False,
            'cover_rows': ctx['cover_rows'], 'total': ctx['total'],
            'piece': ctx['pieces'][0] if ctx['pieces'] else None})


class RepartitionDesCouplesTests(EnteteDeuxColonnesBaseTest):

    @staticmethod
    def _colonnes(html):
        """Contenu de chaque colonne. Découpage sur la table interne : une expression
        s'arrêtant au premier `</td>` capterait la première cellule, pas la colonne."""
        return [chunk.split('</table>')[0]
                for chunk in html.split('<td class="ip-col">')[1:]]

    def _couples_par_colonne(self, html):
        """Nombre de couples « clé : valeur » dans chaque colonne de l'agencement."""
        return [bloc.count('class="lbl"') for bloc in self._colonnes(html)]

    def test_trois_couples_a_gauche_trois_a_droite(self):
        ssdgps = self._ssdgps('mono-session')          # session implicite → libellé présent
        Session.objects.filter(ssdgps=ssdgps).update(
            date_session=datetime(2024, 1, 14, tzinfo=dt_timezone.utc))
        self.assertEqual(self._couples_par_colonne(self._rendu_partiel(ssdgps)), [3, 3])

    def test_colonne_droite_a_deux_couples_sans_session(self):
        """Sans session unique à nommer, la ligne « Session » disparaît : 3 + 2."""
        ssdgps = self._ssdgps('multi-session')
        Session.objects.create(ssdgps=ssdgps, numero_session=1)
        Session.objects.create(ssdgps=ssdgps, numero_session=2)
        self.assertEqual(self._couples_par_colonne(self._rendu_partiel(ssdgps)), [3, 2])

    def test_colonne_gauche_identifie_la_propriete(self):
        html = self._rendu_partiel(self._ssdgps())
        gauche = self._colonnes(html)[0]
        for libelle in ('Propriété Dite', 'Réquisition', 'Titre'):
            self.assertIn(libelle, gauche)

    def test_colonne_droite_porte_les_natures(self):
        html = self._rendu_partiel(self._ssdgps())
        droite = self._colonnes(html)[1]
        self.assertIn('Nature', droite)
        self.assertIn('PDC/GPS', droite)

    def test_libelles_abreges_en_mode_compact(self):
        """L'en-tête courant des pages de contenu dispose de moins de place."""
        compact = self._rendu_partiel(self._ssdgps(), compact=True)
        self.assertIn('Nature SDGPS', compact)
        self.assertNotIn('Nature du Sous Dossier GPS', compact)

    def test_libelles_complets_hors_mode_compact(self):
        normal = self._rendu_partiel(self._ssdgps())
        self.assertIn('Nature du Sous Dossier GPS', normal)


class AbsenceDeSeparationVisibleTests(EnteteDeuxColonnesBaseTest):

    def test_aucune_bordure_ni_fond_sur_l_agencement(self):
        """Exigence explicite : les deux colonnes ne doivent pas être matérialisées."""
        css = self._rendu_gabarit('piece', self._ssdgps())
        regle = re.search(r'table\.info-split > tbody > tr > td\.ip-col\s*\{([^}]*)\}', css)
        self.assertIsNotNone(regle, "règle .ip-col introuvable")
        self.assertIn('border: 0', regle.group(1))
        self.assertIn('background: none', regle.group(1))

    def test_largeur_des_colonnes_non_imposee(self):
        """Figées à 50 %, la colonne de droite manquait de place et sa valeur passait à
        la ligne (« BC du 01/02/2024 » coupé en deux). Les largeurs restent libres."""
        css = self._rendu_gabarit('piece', self._ssdgps())
        regle = re.search(r'table\.info-split > tbody > tr > td\.ip-col\s*\{([^}]*)\}', css)
        self.assertNotIn('width: 50%', regle.group(1))


class UtilisationParLesEntetesTests(EnteteDeuxColonnesBaseTest):

    def test_entete_courant_des_pages_de_contenu_utilise_l_agencement(self):
        """C'est l'en-tête répété sur toutes les pages de tableaux, images et photos —
        celui qui chevauchait le tableau de données."""
        ctx = self._contexte(self._ssdgps())
        html = render_to_string('pieces/_content_head.html',
                                {'header': ctx['header'], 'piece': ctx['pieces'][0]})
        self.assertIn('info-split', html)
        self.assertIn('info-split-compact', html)

    def test_separateur_de_piece_utilise_l_agencement(self):
        html = self._rendu_gabarit('piece', self._ssdgps())
        self.assertIn('info-split', html)

    def test_agencement_applique_a_toutes_les_pieces(self):
        """« sur toutes les pièces, et non pas seulement celles qui chevauchaient » :
        l'agencement ne dépend d'aucun type de pièce."""
        for type_piece in ('RDL', 'RDI', 'LPA', 'ROB', 'RDD', 'RC'):
            ssdgps = Ssdgps.objects.create(
                nature_ssdgps='PDC/GPS', numero_ssdgps=100 + ord(type_piece[-1]),
                type_ssdgps='multi-session', affaire=self.affaire)
            ctx = build_report_context(ssdgps, None, [self._piece(ssdgps, type_piece)])
            html = render_to_string('pieces/_content_head.html',
                                    {'header': ctx['header'], 'piece': ctx['pieces'][0]})
            self.assertIn('info-split', html, f'manquant pour {type_piece}')


class LargeurBoiteDeMargeTests(EnteteDeuxColonnesBaseTest):
    """Garde-fou sur la cause géométrique du chevauchement."""

    def test_top_center_declare_une_largeur(self):
        """Sans largeur, WeasyPrint résout cette boîte à 0 mm et l'encadré déborde."""
        css = self._rendu_gabarit('piece', self._ssdgps())
        for slot in ('chead', 'chead2'):
            regle = re.search(
                r'@top-center \{ content: element\(' + slot + r'\);([^}]*)\}', css)
            self.assertIsNotNone(regle, f'@top-center pour {slot} introuvable')
            self.assertIn('width:', regle.group(1),
                          f'largeur absente sur @top-center({slot})')

    def test_largeur_suit_l_orientation_du_contenu(self):
        """200 mm en portrait, 287 mm en paysage — mêmes valeurs que @bottom-center."""
        ssdgps = self._ssdgps()
        piece = self._piece(ssdgps, 'RDL')          # RDL → paysage automatique
        ctx = build_report_context(ssdgps, None, [piece])
        rendu = ctx['pieces'][0]
        self.assertTrue(rendu['content_landscape'])

        css = render_to_string(GABARIT, {
            'header': ctx['header'], 'mode': 'piece', 'foot_prefix': '',
            'duplex': False, 'piece': rendu})
        haut = re.search(r'@top-center \{ content: element\(chead\);([^}]*)\}', css)
        self.assertIn('287mm', haut.group(1))
