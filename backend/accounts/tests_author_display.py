"""Colonnes « Créé par » / « Modifié par » / « Supprimé par » : NOM COMPLET de l'auteur.

Ces colonnes affichent le nom complet de l'utilisateur (repli : email quand le compte n'a ni
prénom ni nom). Le nom des champs exposés reste `*_by_email` : il est figé dans les allowlists
et dans les configurations de colonnes déjà enregistrées par les opérateurs — seule la VALEUR
change (cf. `accounts/fields.AuthorDisplayField`).
"""
from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.fields import author_display
from accounts.models import Organization
from organismes.models import OrganismeNiveau1
from organismes.serializers import OrganismeNiveau1Serializer
from organizations.serializers import OrganizationListSerializer, OrganizationSerializer

User = get_user_model()


class AuthorDisplayTests(TestCase):
    def test_nom_complet(self):
        u = User(email='j.dupont@sdgps.ma', first_name='Jean', last_name='Dupont')
        self.assertEqual(author_display(u), 'Jean Dupont')

    def test_prenom_ou_nom_seul(self):
        self.assertEqual(author_display(User(email='a@sdgps.ma', first_name='Amina')), 'Amina')
        self.assertEqual(author_display(User(email='b@sdgps.ma', last_name='Alaoui')), 'Alaoui')

    def test_repli_sur_email_si_aucun_nom(self):
        """Sans repli, la colonne resterait vide pour les comptes techniques."""
        u = User(email='tech@sdgps.ma', first_name='', last_name='')
        self.assertEqual(author_display(u), 'tech@sdgps.ma')

    def test_auteur_nul(self):
        self.assertIsNone(author_display(None))


class AuthorDisplaySerializerTests(TestCase):
    def setUp(self):
        self.auteur = User.objects.create_user(
            username='jd@sdgps.ma', email='jd@sdgps.ma', password='X@2026',
            first_name='Jean', last_name='Dupont')

    def test_organisation_expose_le_nom_complet(self):
        org = Organization.objects.create(
            code='ORG-N', name='Org', type='PRIVATE',
            created_by=self.auteur, modified_by=self.auteur)
        for serializer in (OrganizationSerializer, OrganizationListSerializer):
            data = serializer(org).data
            self.assertEqual(data['created_by_email'], 'Jean Dupont', msg=serializer.__name__)
            self.assertEqual(data['modified_by_email'], 'Jean Dupont', msg=serializer.__name__)
            # Alias unifié : même valeur que `modified_by_email`.
            self.assertEqual(data['updated_by_email'], 'Jean Dupont', msg=serializer.__name__)

    def test_champ_present_meme_sans_auteur(self):
        """Régression : un champ omis (SkipField) ferait disparaître la colonne du tableau."""
        org = Organization.objects.create(code='ORG-S', name='Sans', type='PRIVATE')
        data = OrganizationListSerializer(org).data
        for field in ('created_by_email', 'updated_by_email', 'deleted_by_email'):
            self.assertIn(field, data)
            self.assertIsNone(data[field])

    def test_organisme_expose_le_nom_complet(self):
        n1 = OrganismeNiveau1.objects.create(
            code='N1-N', nom='Direction', created_by=self.auteur, updated_by=self.auteur)
        data = OrganismeNiveau1Serializer(n1).data
        self.assertEqual(data['created_by_email'], 'Jean Dupont')
        self.assertEqual(data['updated_by_email'], 'Jean Dupont')
        self.assertIn('deleted_by_email', data)

    def test_repli_email_bout_en_bout(self):
        tech = User.objects.create_user(
            username='tech@sdgps.ma', email='tech@sdgps.ma', password='X@2026')
        org = Organization.objects.create(
            code='ORG-T', name='Tech', type='PRIVATE', created_by=tech)
        self.assertEqual(OrganizationListSerializer(org).data['created_by_email'],
                         'tech@sdgps.ma')
