"""
Historique des versions d'une pièce.

- tout changement de `payload` archive l'ancien contenu (auteur et date d'origine,
  remplaçant), quel que soit le chemin (API, ré-import, modèle) ; rien à la création ni
  quand seul un autre champ change ;
- la comparaison rapproche les lignes par `id` et détaille les cellules modifiées ;
- la restauration archive le contenu courant, repasse la pièce en brouillon et est
  refusée sur un dossier figé ;
- l'historique suit la portée RBAC de la pièce (404 hors portée) ;
- au plus `MAX_VERSIONS` versions par pièce.
"""
from unittest import mock

from django.contrib.auth import get_user_model

from pieces.models import Piece, PieceVersion
from pieces.versions import comparer
from projects.models import Ssdgps
from projects.tests_workflow_ssdgps import WorkflowBaseTest

User = get_user_model()

V1 = {'rows': [{'id': 1, 'point': 'A', 'x': '1'}, {'id': 2, 'point': 'B', 'x': '2'}], 'sort': []}
V2 = {'rows': [{'id': 1, 'point': 'A', 'x': '1.5'}, {'id': 3, 'point': 'C', 'x': '3'}], 'sort': [{'field': 'x'}]}


class VersionsTests(WorkflowBaseTest):
    def setUp(self):
        super().setUp()
        self.piece = Piece.objects.create(ssdgps=self.ssdgps, type_piece='LPA', payload=V1,
                                          created_by=self.agent, updated_by=self.agent)

    def url(self, suffixe=''):
        return f'/api/v1/pieces/{self.piece.id}/versions/{suffixe}'

    def test_creation_sans_version_puis_archivage_a_chaque_changement(self):
        self.assertFalse(PieceVersion.objects.exists())
        self.piece.payload = V2
        self.piece.updated_by = self.admin
        self.piece.save()
        v = PieceVersion.objects.get()
        self.assertEqual((v.numero, v.payload, v.auteur, v.remplacee_par), (1, V1, self.agent, self.admin))
        self.piece.commentaire = 'x'
        self.piece.save(update_fields=['commentaire'])
        self.piece.save()   # payload inchangé
        self.assertEqual(PieceVersion.objects.count(), 1)

    def test_modification_par_l_api_archive(self):
        r = self.client.patch(f'/api/v1/pieces/{self.piece.id}/', {'payload': V2}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(PieceVersion.objects.get().payload, V1)

    def test_liste_detail_et_comparaison(self):
        self.piece.payload = V2
        self.piece.save()
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['courante']['lignes'], 2)
        self.assertEqual([v['numero'] for v in r.data['versions']], [1])
        self.assertEqual(self.client.get(self.url('1/')).data['payload'], V1)
        diff = self.client.get(self.url('1/comparer/')).data
        self.assertEqual([x['id'] for x in diff['ajoutees']], [3])
        self.assertEqual([x['id'] for x in diff['supprimees']], [2])
        self.assertEqual(diff['modifiees'][0]['colonnes'], ['x'])
        self.assertEqual(diff['autres_cles'], ['sort'])
        self.assertEqual(self.client.get(self.url('9/')).status_code, 404)
        self.assertEqual(self.client.get(self.url('1/comparer/?avec=7')).status_code, 404)

    def test_restauration(self):
        self.piece.payload = V2
        self.piece.statut = Piece.Statut.VALIDE
        self.piece.save()
        r = self.client.post(self.url('1/restaurer/'))
        self.assertEqual(r.status_code, 200)
        self.piece.refresh_from_db()
        self.assertEqual(self.piece.payload, V1)
        self.assertEqual(self.piece.statut, Piece.Statut.BROUILLON)
        derniere = PieceVersion.objects.order_by('-numero').first()
        self.assertEqual((derniere.numero, derniere.payload, derniere.origine), (2, V2, 'restauration'))

    def test_restauration_refusee_sur_dossier_fige(self):
        self.piece.payload = V2
        self.piece.save()
        Ssdgps.objects.filter(pk=self.ssdgps.pk).update(statut=Ssdgps.Statut.SOUMIS)
        self.assertEqual(self.client.post(self.url('1/restaurer/')).status_code, 403)
        self.assertEqual(self.client.get(self.url()).status_code, 200)   # la lecture reste ouverte

    def test_hors_portee_404(self):
        etranger = User.objects.create_user(username='e@x.ma', email='e@x.ma', password='Passw0rd!')
        self.client.force_authenticate(etranger)
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_plafond_de_versions(self):
        with mock.patch('pieces.versions.MAX_VERSIONS', 3):
            for i in range(5):
                self.piece.payload = {'rows': [{'id': 1, 'x': str(i)}]}
                self.piece.save()
        self.assertEqual(list(PieceVersion.objects.order_by('numero').values_list('numero', flat=True)), [3, 4, 5])


class ComparerTests(WorkflowBaseTest):
    def test_lignes_sans_id_rapprochees_par_position(self):
        d = comparer({'rows': [{'a': 1}, {'a': 2}]}, {'rows': [{'a': 1}, {'a': 9}, {'a': 3}]})
        self.assertEqual(d['identiques'], 1)
        self.assertEqual(d['modifiees'][0]['colonnes'], ['a'])
        self.assertEqual(d['ajoutees'], [{'a': 3}])
