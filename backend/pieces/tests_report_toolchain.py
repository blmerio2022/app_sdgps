"""Robustesse de la chaîne de dépendances du RAPPORT PDF.

Bug couvert : `reportlab` n'était pas installé sur l'environnement d'exécution. Comme il
n'est utilisé qu'à la toute fin (`_overlay_global_pagination`, pagination « Page i/n »),
WeasyPrint rendait d'abord l'intégralité du rapport — plus d'une minute — puis la
génération échouait sur un `ModuleNotFoundError` non intercepté. Côté opérateur : barre
de progression figée à 90 % (plafond de la progression simulée), puis message d'erreur
générique sans aucune piste.

Deux garde-fous sont vérifiés ici :

1. la chaîne est contrôlée **en bloc et en amont** du rendu (`check_pdf_toolchain`), donc
   l'échec est immédiat et le message nomme le paquet manquant ;
2. la vue `report/` ne laisse **jamais** remonter une exception nue : dépendance manquante
   → 501, toute autre défaillance → 500, les deux avec un `detail` exploitable.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from accounts.models import Membership, Organization
from pieces import report as report_module
from pieces.models import Piece
from pieces.report import (PDF_REQUIREMENTS, check_pdf_toolchain,
                           missing_pdf_requirements)
from projects.models import Affaire, Projet, Propriete, Ssdgps

User = get_user_model()


class ChaineDependancesPdfTests(SimpleTestCase):
    """`missing_pdf_requirements` / `check_pdf_toolchain` — détection en amont."""

    def test_les_trois_dependances_sont_declarees(self):
        """reportlab doit figurer dans la chaîne : c'est l'oubli à l'origine du bug."""
        modules = [mod for mod, _role in PDF_REQUIREMENTS]
        self.assertEqual(modules, ['weasyprint', 'pypdf', 'reportlab'])

    def test_environnement_complet_ne_leve_rien(self):
        """Sur un environnement correctement installé, la vérification est transparente."""
        self.assertEqual(missing_pdf_requirements(), [])
        check_pdf_toolchain()          # ne doit pas lever

    def test_module_absent_est_signale(self):
        """Un `ModuleNotFoundError` à l'import est remonté avec son rôle fonctionnel."""
        def _import(nom):
            if nom == 'reportlab':
                raise ModuleNotFoundError("No module named 'reportlab'")
            return object()

        with patch('importlib.import_module', side_effect=_import):
            manquants = missing_pdf_requirements()

        self.assertEqual(len(manquants), 1)
        module, role, detail = manquants[0]
        self.assertEqual(module, 'reportlab')
        self.assertIn('pagination', role)
        self.assertIn('reportlab', detail)

    def test_bibliotheque_native_absente_est_signalee(self):
        """WeasyPrint s'importe mais lève `OSError` sans GTK/Pango/Cairo : même traitement."""
        def _import(nom):
            if nom == 'weasyprint':
                raise OSError('cannot load library libgobject-2.0-0')
            return object()

        with patch('importlib.import_module', side_effect=_import):
            manquants = missing_pdf_requirements()

        self.assertEqual([m[0] for m in manquants], ['weasyprint'])

    def test_message_nomme_tous_les_paquets_manquants(self):
        """Le message doit être actionnable : paquets manquants + commande d'installation."""
        def _import(nom):
            if nom in ('pypdf', 'reportlab'):
                raise ModuleNotFoundError(f"No module named '{nom}'")
            return object()

        with patch('importlib.import_module', side_effect=_import):
            with self.assertRaises(RuntimeError) as ctx:
                check_pdf_toolchain()

        message = str(ctx.exception)
        self.assertIn('pypdf', message)
        self.assertIn('reportlab', message)
        self.assertIn('pip install', message)
        self.assertIn('requirements.txt', message)

    def test_verification_avant_tout_rendu(self):
        """Garde-fou central : `render_report_pdf` échoue AVANT de rendre quoi que ce soit.

        Sans cela, l'absence de reportlab ne se révélait qu'après le rendu complet —
        plus d'une minute perdue pour une erreur connaissable en moins d'une seconde."""
        with patch.object(report_module, 'check_pdf_toolchain',
                          side_effect=RuntimeError('chaîne indisponible')) as check, \
             patch.object(report_module, 'build_report_context') as build:
            with self.assertRaises(RuntimeError):
                report_module.render_report_pdf(object(), None, [])

        check.assert_called_once()
        build.assert_not_called()      # aucun rendu n'a été entamé


class VueRapportEchecsTests(TestCase):
    """La vue `report/` renvoie toujours un `detail` exploitable, jamais une 500 nue."""

    def setUp(self):
        self.org = Organization.objects.create(code='ORG-RAP', name='Org rapport')
        self.user = User.objects.create_user(
            username='rapport@sdgps.ma', email='rapport@sdgps.ma', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        projet = Projet.objects.create(nom_projet='P', code_projet='P-RAP-1',
                                       organization=self.org, created_by=self.user)
        propriete = Propriete.objects.create(nom_propriete='X', id_requisition='R19000/55',
                                             projet=projet)
        affaire = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                         nature_affaire='BI', date_bornage='2023-04-09',
                                         propriete=propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='multi-session', affaire=affaire)
        Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', numero=1,
                             statut='valide', ordre=1)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _get(self):
        """Appelle l'endpoint en neutralisant le logger `django.request`.

        Django journalise toute réponse >= 500 (nos 501 et 500 comprises) via ses propres
        gestionnaires ; `assertLogs` les remplace le temps de l'appel, ce qui évite de
        dépendre du `AdminEmailHandler` — et donc de polluer la sortie des tests."""
        with self.assertLogs('django.request', level='ERROR'):
            return self.client.get('/api/v1/pieces/report/', {'ssdgps': str(self.ssdgps.pk)})

    def test_dependance_manquante_renvoie_501_et_message(self):
        """Le message du `RuntimeError` est transmis tel quel à la modale."""
        with patch('pieces.views.render_report_pdf',
                   side_effect=RuntimeError('reportlab absent du serveur')):
            resp = self._get()

        self.assertEqual(resp.status_code, 501)
        self.assertIn('reportlab absent du serveur', resp.data['detail'])

    def test_echec_inattendu_renvoie_500_avec_detail(self):
        """Avant le correctif, un `ModuleNotFoundError` remontait nu : la modale
        n'affichait qu'« Erreur lors de la génération du rapport. »"""
        with patch('pieces.views.render_report_pdf',
                   side_effect=ModuleNotFoundError("No module named 'reportlab'")):
            resp = self._get()

        self.assertEqual(resp.status_code, 500)
        detail = resp.data['detail']
        self.assertIn('ModuleNotFoundError', detail)
        self.assertIn('reportlab', detail)

    def test_aucune_piece_valide_renvoie_400(self):
        """Cas métier déjà en place — non régressé par le nouveau garde-fou.

        Une 400 n'est pas journalisée comme erreur serveur : appel direct, sans
        `assertLogs` (qui exigerait au moins un enregistrement)."""
        Piece.objects.filter(ssdgps=self.ssdgps).update(statut='brouillon')
        resp = self.client.get('/api/v1/pieces/report/', {'ssdgps': str(self.ssdgps.pk)})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Aucune pièce valide', resp.data['detail'])


class PolicePaginationTests(SimpleTestCase):
    """Police du numéro global « Page i/n », imprimé par reportlab en surimpression.

    Défaut corrigé : la résolution ne connaissait que des chemins Linux (URW Bookman
    Type1). Partout ailleurs — les postes de développement Windows, où le rapport est
    pourtant rendu en Bookman Old Style — elle retombait sur Times-Bold, et la
    pagination s'affichait dans une autre typographie que l'identification qui lui fait
    face sur la même ligne.
    """

    def setUp(self):
        self._precedent = report_module._PAGINATION_FONT
        report_module._PAGINATION_FONT = None       # la résolution est mise en cache

    def tearDown(self):
        report_module._PAGINATION_FONT = self._precedent

    def test_les_deux_familles_de_chemins_sont_couvertes(self):
        """Image Docker (Linux/URW) ET postes de développement (Windows/Bookman)."""
        chemins = [f for f, _afm in report_module._PAGINATION_FONT_FILES]
        self.assertTrue(any('urw-base35' in c for c in chemins))
        self.assertTrue(any('BOOKOSB' in c.upper() for c in chemins))

    def test_bookman_est_cherche_avant_times(self):
        """L'ordre reproduit la pile CSS du gabarit : Bookman d'abord, Times en repli."""
        chemins = [f.upper() for f, _afm in report_module._PAGINATION_FONT_FILES]
        premier_times = next(i for i, c in enumerate(chemins) if 'TIMES' in c
                             or 'LIBERATIONSERIF' in c)
        dernier_bookman = max(i for i, c in enumerate(chemins) if 'BOOKMAN' in c
                              or 'BOOKOS' in c)
        self.assertLess(dernier_bookman, premier_times)

    def test_la_police_resolue_est_enregistree(self):
        from reportlab.pdfbase import pdfmetrics
        nom = report_module._pagination_font()
        self.assertIsNotNone(pdfmetrics.getFont(nom))

    def test_le_premier_fichier_present_l_emporte(self):
        """Un candidat prioritaire présent évite de descendre jusqu'au repli."""
        import os
        presents = [f for f, afm in report_module._PAGINATION_FONT_FILES
                    if os.path.exists(f) and (not afm or os.path.exists(afm))]
        if not presents:
            self.skipTest('aucune police candidate sur cet environnement')
        self.assertEqual(report_module._pagination_font(), 'ReportBookman')

    def test_repli_sur_la_police_integree_sans_aucun_fichier(self):
        """Sans le moindre fichier, la génération ne doit pas échouer : Times-Bold est
        intégrée à tout lecteur PDF et ne demande rien au système."""
        with patch.object(report_module, '_PAGINATION_FONT_FILES', ()):
            self.assertEqual(report_module._pagination_font(), 'Times-Bold')

    def test_un_fichier_illisible_n_interrompt_pas_la_generation(self):
        """Une variante que reportlab ne sait pas lire fait passer au candidat suivant."""
        with patch.object(report_module, '_PAGINATION_FONT_FILES',
                          (('C:/Windows/Fonts/BOOKOSB.TTF', None),)), \
             patch('reportlab.pdfbase.ttfonts.TTFont', side_effect=ValueError('illisible')):
            self.assertEqual(report_module._pagination_font(), 'Times-Bold')

    def test_resolution_mise_en_cache(self):
        premier = report_module._pagination_font()
        with patch.object(report_module, '_PAGINATION_FONT_FILES', ()):
            self.assertEqual(report_module._pagination_font(), premier)
