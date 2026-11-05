"""
Séparation des deux textes libres d'une pièce.

- `commentaire` (« Observations » dans l'UI) alimente la colonne « Observations » de la
  page de garde du SSDGPS.
- `notes_internes` est strictement interne à l'application : il ne doit apparaître dans
  AUCUNE sortie du rapport PDF.
"""
import json
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Organization, Membership
from pieces.models import Piece
from pieces.report import build_report_context
from projects.models import Projet, Propriete, Affaire, Ssdgps

User = get_user_model()

SECRET = 'NOTE-INTERNE-A-NE-PAS-IMPRIMER'


class NotesInternesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(code='ORG-N', name='Org notes')
        self.user = User.objects.create_user(
            username='n@example.com', email='n@example.com', password='Passw0rd!')
        Membership.objects.create(user=self.user, organization=self.org,
                                  role='ROLE_ORGANISATION_AGENT')
        self.client.force_authenticate(self.user)

        projet = Projet.objects.create(nom_projet='P', code_projet='P-NOTES',
                                       organization=self.org, created_by=self.user)
        propriete = Propriete.objects.create(nom_propriete='Prop', id_requisition='R1/1',
                                             projet=projet)
        affaire = Affaire.objects.create(numero_sd_affaire=1, nature_procedure_affaire='IFF',
                                         nature_affaire='BI',
                                         date_bornage=datetime(2023, 4, 9, tzinfo=dt_timezone.utc),
                                         propriete=propriete)
        self.ssdgps = Ssdgps.objects.create(nature_ssdgps='PDC/GPS', numero_ssdgps=1,
                                            type_ssdgps='mono-session', affaire=affaire)
        self.piece = Piece.objects.create(
            type_piece='ROB', ssdgps=self.ssdgps, source_saisie='manuel',
            commentaire='Contrôlée le 12/05.', notes_internes=SECRET,
        )

    # --- Page de garde -----------------------------------------------------
    def test_observations_de_la_page_de_garde_viennent_du_commentaire(self):
        context = build_report_context(self.ssdgps, None, [self.piece])
        self.assertEqual(context['cover_rows'][0]['observations'], 'Contrôlée le 12/05.')

    def test_notes_internes_absentes_de_tout_le_contexte_du_rapport(self):
        """Garde-fou global : la valeur ne doit apparaître nulle part dans le contexte
        sérialisé du rapport (page de garde comme contenu des pièces)."""
        context = build_report_context(self.ssdgps, None, [self.piece])
        self.assertNotIn(SECRET, json.dumps(context, default=str))

    def test_notes_internes_ne_remplacent_pas_les_observations_vides(self):
        """Une pièce sans observation garde une colonne vide — la note interne ne comble pas."""
        self.piece.commentaire = ''
        self.piece.save(update_fields=['commentaire'])
        context = build_report_context(self.ssdgps, None, [self.piece])
        self.assertEqual(context['cover_rows'][0]['observations'], '')

    # --- API ---------------------------------------------------------------
    def test_api_expose_et_enregistre_les_deux_champs(self):
        resp = self.client.get(f'/api/v1/pieces/{self.piece.id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['notes_internes'], SECRET)
        self.assertEqual(resp.json()['commentaire'], 'Contrôlée le 12/05.')

        resp = self.client.patch(f'/api/v1/pieces/{self.piece.id}/',
                                 {'notes_internes': 'Revoir le point 12'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.piece.refresh_from_db()
        self.assertEqual(self.piece.notes_internes, 'Revoir le point 12')
        # Les deux champs sont indépendants : modifier l'un ne touche pas l'autre.
        self.assertEqual(self.piece.commentaire, 'Contrôlée le 12/05.')

    def test_notes_internes_optionnelles(self):
        piece = Piece.objects.create(type_piece='RTLB', ssdgps=self.ssdgps,
                                     source_saisie='manuel')
        self.assertEqual(piece.notes_internes, '')
        resp = self.client.get(f'/api/v1/pieces/{piece.id}/')
        self.assertEqual(resp.json()['notes_internes'], '')
