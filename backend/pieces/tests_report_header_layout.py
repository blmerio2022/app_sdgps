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

    def _rendu_partiel(self, ssdgps, session=None, compact=False, split=True):
        """`split` reflète `piece.content_landscape` : deux colonnes en paysage,
        liste simple en portrait."""
        ctx = self._contexte(ssdgps, session)
        return render_to_string(
            PARTIEL, {'header': ctx['header'], 'compact': compact, 'split': split})

    def _entete_courant(self, ssdgps, type_piece='RDL', session=None):
        """Rendu de l'en-tête courant réel, orientation comprise."""
        ctx = build_report_context(ssdgps, session, [self._piece(ssdgps, type_piece)])
        return render_to_string('pieces/_content_head.html',
                                {'header': ctx['header'], 'piece': ctx['pieces'][0]})

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
        # Session unique NOMMÉE : multi-session à une seule session. (Un mono-session
        # n'affiche plus aucune session — cf. tests_report_session.MonoSessionSansSessionTests.)
        ssdgps = self._ssdgps('multi-session')
        Session.objects.create(ssdgps=ssdgps, numero_session=1,
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

    def test_libelles_complets_disponibles_hors_mode_compact(self):
        """Le partiel reste utilisable en libellés longs (il n'est aujourd'hui branché
        qu'en mode compact, sur l'en-tête courant)."""
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

    def test_entete_courant_en_deux_colonnes_SEULEMENT_en_paysage(self):
        """RDL est en paysage automatique : l'encadré fait 287 mm, la hauteur est la
        ressource rare → deux colonnes."""
        html = self._entete_courant(self._ssdgps(), 'RDL')
        self.assertIn('info-split', html)
        self.assertIn('info-split-compact', html)

    def test_entete_courant_en_une_colonne_en_portrait(self):
        """RDC est en portrait : l'encadré n'y fait que 200 mm. Scindé, chaque colonne
        serait trop étroite et les valeurs passeraient à la ligne."""
        html = self._entete_courant(self._ssdgps(), 'RDC')
        self.assertNotIn('info-split', html)
        self.assertIn('info-compact', html)
        # Les couples sont bien là, simplement empilés.
        for libelle in ('Propriété Dite', 'Réquisition', 'Titre',
                        'Nature Affaire', 'Nature SDGPS'):
            self.assertIn(libelle, html)

    def test_separateur_de_piece_garde_une_seule_colonne(self):
        """La page-séparateur liste ses couples les uns SOUS les autres, comme à
        l'origine : elle dispose de toute la hauteur de la page et n'a jamais
        chevauché quoi que ce soit. Seul l'en-tête courant est en deux colonnes."""
        html = self._rendu_gabarit('piece', self._ssdgps())
        separateur = html.split('class="sep-title"')[1].split('</section>')[0]
        self.assertNotIn('info-split', separateur)
        self.assertIn('<table class="info">', separateur)
        self.assertIn('Nature du Sous Dossier GPS', separateur)

    def test_agencement_pilote_par_l_orientation_et_non_par_le_type(self):
        """« sur toutes les pièces, et non pas seulement celles qui chevauchaient » :
        le critère est l'ORIENTATION du contenu, identique pour tous les types qui la
        partagent — aucun type n'est traité à part."""
        from pieces.report import resolve_orientation
        for numero, type_piece in enumerate(('RDL', 'RDI', 'LPA', 'ROB', 'RDD', 'RC',
                                             'RDC'), start=100):
            ssdgps = Ssdgps.objects.create(
                nature_ssdgps='PDC/GPS', numero_ssdgps=numero,
                type_ssdgps='multi-session', affaire=self.affaire)
            piece = self._piece(ssdgps, type_piece)
            paysage = resolve_orientation(piece, ssdgps) == 'paysage'
            ctx = build_report_context(ssdgps, None, [piece])
            html = render_to_string('pieces/_content_head.html',
                                    {'header': ctx['header'], 'piece': ctx['pieces'][0]})
            if paysage:
                self.assertIn('info-split', html, f'deux colonnes attendues : {type_piece}')
            else:
                self.assertNotIn('info-split', html, f'une colonne attendue : {type_piece}')


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


class MargeHauteAdaptativeTests(EnteteDeuxColonnesBaseTest):
    """L'en-tête répété vit dans la marge haute des pages de contenu : il ne repousse
    jamais le tableau. Quand il est plus haut que la marge (titre long + mention de
    version, ligne de session, organismes au nom long), il le recouvrait — constaté sur
    le RDIA d'un SDGPS réel. `render_report_pdf` mesure désormais l'en-tête dans la mise
    en page et relève la marge de la pièce si besoin."""

    def _doc(self, ssdgps, pieces, marge=None):
        from weasyprint import HTML
        from pieces.report import flat_blocks, _group_versions
        ctx = build_report_context(ssdgps, None, pieces)
        p = ctx['pieces'][0]
        blocks = flat_blocks(p['content'].get('tables') or [])
        piece = {**p, 'content': {**p['content'], 'blocks': blocks,
                                  'versions': _group_versions(blocks)}}
        extra = {'content_margin_top': marge} if marge else {}
        html = render_to_string(GABARIT, {'header': ctx['header'], 'mode': 'piece',
                                          'foot_prefix': '', 'duplex': False,
                                          'piece': piece, **extra})
        return HTML(string=html).render()

    def _ecarts(self, doc):
        """(bas de l'en-tête, haut du premier tableau) en mm, par page de contenu."""
        from pieces.report import _walk_boxes, _PX_PER_MM
        mesures = []
        for page in doc.pages:
            bas = haut = None
            for b in _walk_boxes(page._page_box):
                el = getattr(b, 'element', None)
                cls = (el.get('class') or '').split() if el is not None else []
                if 'content-head' in cls:
                    bas = (b.position_y + b.margin_height()) / _PX_PER_MM
                if el is not None and el.tag == 'table' and 'data' in cls and haut is None:
                    haut = b.position_y / _PX_PER_MM
            if bas is not None and haut is not None:
                mesures.append((bas, haut))
        return mesures

    def _entete_haut(self):
        """SDGPS dont l'en-tête dépasse la marge par défaut : organismes au nom long et
        session nommée (multi-session à une seule session)."""
        from organismes.models import OrganismeNiveau1, OrganismeNiveau2
        # Noms volontairement très longs : la colonne gauche de l'encadré (150 px, 7 pt)
        # passe sur de nombreuses lignes et l'en-tête dépasse les 43 mm de marge.
        long = ('AGENCE NATIONALE DE LA CONSERVATION FONCIÈRE, DU CADASTRE ET DE LA '
                'CARTOGRAPHIE — DIRECTION RÉGIONALE ')
        n1 = OrganismeNiveau1.objects.create(code='L1', nom=long * 2)
        n2 = OrganismeNiveau2.objects.create(code='L2', niveau1=n1, nom=long * 2)
        self.affaire.propriete.organisme_niveau1 = n1
        self.affaire.propriete.organisme_niveau2 = n2
        self.affaire.propriete.save()
        ssdgps = self._ssdgps('multi-session')
        Session.objects.create(ssdgps=ssdgps, numero_session=1,
                               date_session=datetime(2024, 1, 14, tzinfo=dt_timezone.utc))
        piece = Piece.objects.create(
            ssdgps=ssdgps, type_piece='RDL', statut='valide', ordre=1, source_saisie='manuel',
            payload={'rows': [{'id': i, 'nom_point': f'B{i}', 'x_m': 1, 'y_m': 2,
                               'sigma_x_m': 0.01, 'sigma_y_m': 0.01} for i in range(60)]})
        return ssdgps, [piece]

    def test_marge_par_defaut_suffisante_pour_un_entete_ordinaire(self):
        from pieces.report import required_content_margin_mm
        ssdgps = self._ssdgps()
        self.assertIsNone(required_content_margin_mm(self._doc(ssdgps, [self._piece(ssdgps)])))

    def test_entete_trop_haut_detecte_puis_corrige(self):
        from pieces.report import required_content_margin_mm, CONTENT_MARGIN_TOP_MM, HEADER_GAP_MM
        ssdgps, pieces = self._entete_haut()
        avant = self._doc(ssdgps, pieces)
        marge = required_content_margin_mm(avant)
        self.assertIsNotNone(marge, "l'en-tête long devrait déborder de la marge par défaut")
        self.assertGreater(marge, CONTENT_MARGIN_TOP_MM)
        # Avant : l'en-tête descend sous le début du tableau (ou à moins de l'écart minimal).
        self.assertTrue(any(haut - bas < HEADER_GAP_MM for bas, haut in self._ecarts(avant)))

        apres = self._doc(ssdgps, pieces, marge)
        self.assertIsNone(required_content_margin_mm(apres))
        ecarts = self._ecarts(apres)
        self.assertTrue(ecarts)
        for bas, haut in ecarts:   # sur CHAQUE page de contenu, pas seulement la première
            self.assertGreaterEqual(haut - bas, HEADER_GAP_MM - 0.1)
