"""
Rapport de contrôle (RC) — tableau calculé automatiquement.

Règle métier : pour chaque détermination tenue fixe sur un point ancien F, le tableau
compare, pour **chaque point ancien de la LPA calculé dans cette détermination**, les
coordonnées connues (LPA) aux coordonnées recalculées. La ligne F↔F vaut « -- ».

Régression corrigée ici : la colonne « Nom Point Calculé » ne retenait que les points
anciens tenus FIXES dans au moins une détermination. Un point ancien bel et bien
recalculé, mais jamais tenu fixe, disparaissait du tableau — sur un PDC réel, 5 points
anciens sur 15 manquaient à chaque point fixe, avec des écarts de 2 à 21 cm, donc
certains au-delà de la tolérance de 15 cm. Ce sont exactement les contrôles qu'on perdait.
"""
from django.test import SimpleTestCase

from pieces.rc import compute_rapport_controle


def lpa(*points):
    """[(nom, x, y), …] → lignes LPA."""
    return [{'nom_point': n, 'x_m': x, 'y_m': y} for n, x, y in points]


def det(numero, fixes, calculs):
    """`fixes` = noms tenus FIXE ; `calculs` = {nom: (x, y)} (points fixes compris)."""
    rows = []
    for nom, (x, y) in calculs.items():
        fixe = nom in fixes
        rows.append({
            'nom_point': nom, 'x_m': x, 'y_m': y,
            'sigma_x_m': 'FIXE' if fixe else '0.020',
            'sigma_y_m': 'FIXE' if fixe else '0.022',
        })
    return {'numero': numero, 'rows': rows}


def paires(rows):
    return [(r['nom_point_fixe'], r['nom_point_calcule']) for r in rows]


class PointsCalculesTests(SimpleTestCase):
    """Le cœur de la correction : qui figure dans « Nom Point Calculé »."""

    def setUp(self):
        # 4 points anciens ; seuls A et B sont tenus fixes, C et D sont recalculés.
        self.points = lpa(('A', '100.00', '200.00'), ('B', '150.00', '250.00'),
                          ('C', '300.00', '400.00'), ('D', '500.00', '600.00'))
        calculs = {'A': ('100.00', '200.00'), 'B': ('150.05', '250.00'),
                   'C': ('300.10', '400.00'), 'D': ('500.00', '600.20')}
        self.determinations = [
            det(1, {'A'}, calculs),
            det(2, {'B'}, {**calculs, 'B': ('150.00', '250.00'), 'A': ('100.05', '200.00')}),
        ]

    def test_un_point_ancien_recalcule_figure_meme_s_il_n_est_jamais_tenu_fixe(self):
        rows = compute_rapport_controle(self.points, self.determinations)

        calcules = {r['nom_point_calcule'] for r in rows if r['nom_point_fixe'] == 'A'}
        self.assertEqual(calcules, {'A', 'B', 'C', 'D'})

    def test_le_tableau_est_complet_pour_chaque_point_fixe(self):
        rows = compute_rapport_controle(self.points, self.determinations)

        self.assertEqual(len(rows), 2 * 4)

    def test_les_ecarts_des_points_jamais_fixes_sont_calcules(self):
        rows = compute_rapport_controle(self.points, self.determinations)

        ligne = next(r for r in rows
                     if r['nom_point_fixe'] == 'A' and r['nom_point_calcule'] == 'C')
        self.assertEqual(ligne['delta_x_m'], '-0.10')
        self.assertEqual(ligne['delta_d_m'], '0.10')

    def test_la_ligne_du_point_fixe_lui_meme_reste_en_tirets(self):
        rows = compute_rapport_controle(self.points, self.determinations)

        ligne = next(r for r in rows
                     if r['nom_point_fixe'] == 'A' and r['nom_point_calcule'] == 'A')
        self.assertEqual((ligne['delta_x_m'], ligne['delta_y_m'], ligne['delta_d_m']),
                         ('--', '--', '--'))

    def test_un_point_de_la_lpa_jamais_recalcule_n_encombre_pas_le_tableau(self):
        # Un point ancien de la zone qui n'entre dans aucune détermination n'a rien à
        # contrôler : l'afficher vide n'apprendrait rien.
        points = self.points + lpa(('Z', '900.00', '900.00'))

        rows = compute_rapport_controle(points, self.determinations)

        self.assertNotIn('Z', {r['nom_point_calcule'] for r in rows})

    def test_les_points_nouveaux_restent_exclus(self):
        # Un point nouveau n'a pas de coordonnée connue : aucun écart n'a de sens.
        determinations = [det(1, {'A'}, {'A': ('100.00', '200.00'),
                                         'B': ('150.05', '250.00'),
                                         'se1': ('700.00', '800.00')})]

        rows = compute_rapport_controle(self.points, determinations)

        self.assertNotIn('se1', {r['nom_point_calcule'] for r in rows})

    def test_les_points_calcules_suivent_l_ordre_de_la_lpa(self):
        rows = compute_rapport_controle(self.points, self.determinations)

        premiers = [r['nom_point_calcule'] for r in rows[:4]]
        self.assertEqual(premiers, ['A', 'B', 'C', 'D'])

    def test_les_identifiants_sont_consecutifs(self):
        rows = compute_rapport_controle(self.points, self.determinations)

        self.assertEqual([r['id'] for r in rows],
                         [str(i) for i in range(1, len(rows) + 1)])


class DeterminationsParticulieresTests(SimpleTestCase):
    def setUp(self):
        self.points = lpa(('A', '100.00', '200.00'), ('B', '150.00', '250.00'),
                          ('C', '300.00', '400.00'))

    def test_une_determination_tenant_PLUSIEURS_points_fixes(self):
        # Le second point fixe était ignoré : il n'entrait pas dans les points de contrôle.
        determinations = [
            det(1, {'A', 'B'}, {'A': ('100.00', '200.00'), 'B': ('150.00', '250.00'),
                                'C': ('300.10', '400.00')}),
        ]

        rows = compute_rapport_controle(self.points, determinations)

        self.assertEqual(paires(rows), [('A', 'A'), ('A', 'B'), ('A', 'C')])
        # Un point tenu fixe ne se contrôle pas contre lui-même : « -- » comme A.
        ligne_b = next(r for r in rows if r['nom_point_calcule'] == 'B')
        self.assertEqual(ligne_b['delta_d_m'], '--')

    def test_un_point_absent_d_une_determination_laisse_une_ligne_vide(self):
        # Le trou doit se VOIR : avant, la ligne disparaissait et le tableau rétrécissait
        # sans rien dire.
        determinations = [
            det(1, {'A'}, {'A': ('100.00', '200.00'), 'B': ('150.05', '250.00'),
                           'C': ('300.10', '400.00')}),
            det(2, {'B'}, {'A': ('100.05', '200.00'), 'B': ('150.00', '250.00')}),
        ]

        rows = compute_rapport_controle(self.points, determinations)

        ligne = next(r for r in rows
                     if r['nom_point_fixe'] == 'B' and r['nom_point_calcule'] == 'C')
        self.assertEqual(ligne['x_m_calcule'], '')
        self.assertEqual(ligne['delta_d_m'], '')
        self.assertEqual(ligne['x_m_fixe'], '300.00')

    def test_une_determination_sans_point_fixe_est_ignoree(self):
        # Détermination LIBRE (RDL) : aucun point tenu fixe, rien à contrôler.
        determinations = [det('Libre', set(), {'A': ('100.00', '200.00')})]

        self.assertEqual(compute_rapport_controle(self.points, determinations), [])

    def test_une_determination_fixee_sur_un_point_hors_lpa_est_ignoree(self):
        determinations = [det(1, {'X'}, {'X': ('1.00', '2.00'), 'A': ('100.05', '200.00')})]

        self.assertEqual(compute_rapport_controle(self.points, determinations), [])

    def test_une_coordonnee_illisible_laisse_les_ecarts_vides(self):
        determinations = [det(1, {'A'}, {'A': ('100.00', '200.00'), 'B': ('?', '250.00')})]

        rows = compute_rapport_controle(self.points, determinations)

        ligne = next(r for r in rows if r['nom_point_calcule'] == 'B')
        self.assertEqual((ligne['delta_x_m'], ligne['delta_d_m']), ('', ''))


class RapprochementDesNomsTests(SimpleTestCase):
    """Les noms viennent de deux pièces importées séparément : ils ne coïncident pas
    toujours au caractère près. Un point perdu pour une casse différente est un contrôle
    perdu en silence."""

    def test_la_casse_et_les_espaces_ne_font_pas_perdre_un_point(self):
        points = lpa(('CTB 26', '300.00', '400.00'), ('A', '100.00', '200.00'))
        determinations = [det(1, {'a'}, {'a': ('100.00', '200.00'),
                                         'ctb26': ('300.10', '400.00')})]

        rows = compute_rapport_controle(points, determinations)

        self.assertEqual(paires(rows), [('A', 'CTB 26'), ('A', 'A')])
        self.assertEqual(next(r for r in rows if r['nom_point_calcule'] == 'CTB 26')['delta_d_m'],
                         '0.10')

    def test_le_libelle_affiche_est_celui_de_la_lpa(self):
        # La LPA est la référence officielle du nom du point ancien.
        points = lpa(('CTB26', '300.00', '400.00'))
        determinations = [det(1, {'ctb26'}, {'ctb26': ('300.00', '400.00')})]

        rows = compute_rapport_controle(points, determinations)

        self.assertEqual(paires(rows), [('CTB26', 'CTB26')])


class CoordonneesTests(SimpleTestCase):
    def test_les_separateurs_de_milliers_et_la_virgule_sont_acceptes(self):
        points = lpa(('A', '353 108.16', '146 858.01'), ('B', '343 717,71', '152 811,69'))
        determinations = [det(1, {'A'}, {'A': ('353 108.16', '146 858.01'),
                                         'B': ('343 717.63', '152 811.78')})]

        rows = compute_rapport_controle(points, determinations)

        ligne = next(r for r in rows if r['nom_point_calcule'] == 'B')
        self.assertEqual((ligne['delta_x_m'], ligne['delta_y_m'], ligne['delta_d_m']),
                         ('0.08', '-0.09', '0.12'))

    def test_les_coordonnees_fixes_sont_celles_de_la_lpa(self):
        points = lpa(('A', '100.00', '200.00'), ('B', '150.00', '250.00'))
        determinations = [det(1, {'A'}, {'A': ('100.00', '200.00'),
                                         'B': ('150.05', '250.07')})]

        rows = compute_rapport_controle(points, determinations)

        ligne = next(r for r in rows if r['nom_point_calcule'] == 'B')
        self.assertEqual((ligne['x_m_fixe'], ligne['y_m_fixe']), ('150.00', '250.00'))
        self.assertEqual((ligne['x_m_calcule'], ligne['y_m_calcule']), ('150.05', '250.07'))


class CaracteresConfondusTests(SimpleTestCase):
    """Cas réel (PDC sdgps-test, 2026-11) : LPA « AXl6 » (L minuscule), RDIA « AXI6 »
    (i majuscule). AXI6 manquait aux points de contrôle, et la détermination N°1, tenue
    fixe sur lui, disparaissait entièrement du tableau (289 lignes au lieu de 324)."""

    def setUp(self):
        self.points = lpa(('AXl6', '100.00', '200.00'), ('B', '150.00', '250.00'),
                          ('C', '300.00', '400.00'))
        calculs = {'AXI6': ('100.03', '200.00'), 'B': ('150.00', '250.00'),
                   'C': ('300.00', '400.04')}
        self.determinations = [
            det('N°1', {'AXI6'}, {**calculs, 'AXI6': ('100.00', '200.00')}),
            det('N°2', {'B'}, calculs),
        ]

    def test_le_point_mal_saisi_dans_la_lpa_est_controle(self):
        rows = compute_rapport_controle(self.points, self.determinations)
        self.assertEqual(len(rows), 6)                       # 2 déterminations × 3 points
        ligne = next(r for r in rows if r['nom_point_fixe'] == 'B'
                     and r['nom_point_calcule'] == 'AXl6')
        self.assertEqual(ligne['delta_d_m'], '0.03')

    def test_la_determination_tenue_fixe_sur_le_point_n_est_plus_perdue(self):
        rows = compute_rapport_controle(self.points, self.determinations)
        fixe = [r for r in rows if r['nom_point_fixe'] == 'AXl6']   # libellé de la LPA
        self.assertEqual(len(fixe), 3)
        self.assertEqual(next(r for r in fixe if r['nom_point_calcule'] == 'AXl6')['delta_d_m'],
                         '--')

    def test_o_et_zero_se_rapprochent(self):
        points = lpa(('P0', '1.00', '1.00'), ('B', '2.00', '2.00'))
        dets = [det(1, {'B'}, {'B': ('2.00', '2.00'), 'PO': ('1.00', '1.02')})]
        rows = compute_rapport_controle(points, dets)
        self.assertEqual(paires(rows), [('B', 'P0'), ('B', 'B')])

    def test_jamais_d_association_si_le_point_lpa_existe_tel_quel(self):
        # « B1 » est recalculé tel quel ; « BI » est un AUTRE point (nouveau) : ne pas les fondre.
        points = lpa(('B1', '1.00', '1.00'), ('F', '2.00', '2.00'))
        dets = [det(1, {'F'}, {'BI': ('9.00', '9.00'), 'B1': ('1.00', '1.01'),
                               'F': ('2.00', '2.00')})]
        ligne = next(r for r in compute_rapport_controle(points, dets)
                     if r['nom_point_calcule'] == 'B1')
        self.assertEqual(ligne['x_m_calcule'], '1.00')

    def test_pas_d_association_ambigue(self):
        # Deux graphies des déterminations pour un seul point LPA : on ne choisit pas.
        points = lpa(('AXl6', '1.00', '1.00'), ('F', '2.00', '2.00'))
        dets = [det(1, {'F'}, {'AXI6': ('1.00', '1.00'), 'F': ('2.00', '2.00')}),
                det(2, {'F'}, {'AX16': ('1.00', '1.00'), 'F': ('2.00', '2.00')})]
        rows = compute_rapport_controle(points, dets)
        self.assertNotIn('AXl6', {r['nom_point_calcule'] for r in rows})
