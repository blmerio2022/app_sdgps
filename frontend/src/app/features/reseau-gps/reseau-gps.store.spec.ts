import { of, throwError } from 'rxjs';
import {
  AnalyseEcarts, ReferentielReseau, ReseauGpsService, ResultatDensification, ResultatReseau, VarianteReseau,
} from '../../core/services/reseau-gps.service';
import { ToastService } from '../../core/services/toast.service';
import { CLE_MES_FONDS } from './fonds-carte';
import { ReseauGpsStore } from './reseau-gps.store';

const REFERENTIEL = {
  zones: [{ code: 'nord', libelle: 'Nord', epsg: 26191 }], zone_defaut: 'nord', types_reseau: [], variantes: [],
  normes: [],
  fonds: {
    categories: [], par_defaut: ['osm'], aide_personnalise: [],
    catalogue: [{ id: 'osm', nom: 'OSM', categorie: 'cartographique', type: 'xyz', url: 'https://a/{z}/{x}/{y}.png',
      attribution: '', licence: '', description: '' }],
  },
  defauts: { longueur_max_km: 10, nb_suggestions_max: 5, points_max: 300, suggestions_max: 15,
    tolerance_rc_m: 0.12, rayon_couverture_km: 5, points_couverture_min: 3, nouveaux_max: 50 },
} as unknown as ReferentielReseau;

function variante(code: string, score: number): VarianteReseau {
  return {
    code, nom: code, description: '', admissible: true, recommandee: code === 'delaunay',
    indicateurs: { score } as any, controles: [],
    lignes: [{ de: 0, a: 1, distance_m: 1, distance_km: 0.001, azimut_deg: 0, en_boucle: true, trop_longue: false }],
    triangles: [], degres: [4, 4, 4], violations_stations_voisines: [],
  };
}

const pts3 = [
  { nom_point: 'A', x_m: 420000, y_m: 380000 },
  { nom_point: 'B', x_m: 423000, y_m: 380000 },
  { nom_point: 'C', x_m: 421500, y_m: 382600 },
  { nom_point: 'D', x_m: 421500, y_m: 381000 },
];

describe('ReseauGpsStore', () => {
  let store: ReseauGpsStore;
  let service: jasmine.SpyObj<ReseauGpsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    localStorage.removeItem(CLE_MES_FONDS);
    service = jasmine.createSpyObj('ReseauGpsService',
      ['referentiel', 'generer', 'sourcesLpa', 'sourceLpa', 'analyserEcarts', 'sourcesRc', 'sourceRc', 'densifier']);
    service.referentiel.and.returnValue(of(REFERENTIEL));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    store = new ReseauGpsStore(service, toast);
    store.init();
  });

  afterEach(() => localStorage.removeItem(CLE_MES_FONDS));

  it('applique le référentiel (tolérance de l\'opérateur, couverture, fonds par défaut)', () => {
    expect(store.toleranceCm).toBe(12);
    expect(store.rayonCouvertureKm).toBe(5);
    expect(store.listeFonds.map(f => f.id)).toEqual(['osm']);
    expect(store.fondActif?.id).toBe('osm');
  });

  it('importe les points anciens, tous retenus et non contrôlés', () => {
    store.definirAnciens(pts3, 'lpa.csv');
    expect(store.anciensRetenus.length).toBe(4);
    expect(store.anciens.every(a => a.homogene === null)).toBeTrue();
    const vue = store.construireVue()!;
    expect(vue.points.length).toBe(4);
    expect(vue.points[0].lat).toBeCloseTo(34.0159, 3);
  });

  it('écarte un point ancien puis le réintègre', () => {
    store.definirAnciens(pts3, '');
    store.basculerRetenu(store.anciens[3]);
    expect(store.anciensRetenus.length).toBe(3);
    expect(store.anciens[3].motifEcart).toContain('opérateur');
    expect(store.construireVue()!.points.find(p => p.nom_point === 'D')!.style).toBe('ecarte');
    store.basculerRetenu(store.anciens[3]);
    expect(store.anciensRetenus.length).toBe(4);
  });

  it('calcule le réseau de contrôle sur les seuls points retenus et marque les suppressions', () => {
    store.definirAnciens(pts3, '');
    store.basculerRetenu(store.anciens[3]);
    const r = {
      points: pts3.slice(0, 3).map((p, i) => ({ ...p, index: i, lat: 34, lon: -6, degre: 2, statut: 'ancien' })),
      variantes: [variante('delaunay', 80)], recommandee: 'delaunay', justification: [],
      parfaite: { ...variante('parfaite', 90), points: [], suggestions: [], conclusion: '' },
      suppressions: [{ index: 0, nom_point: 'A', type: 'proximite', score_avant: 80, score_apres: 85, motif: 'Doublon', justification: '' }],
    } as unknown as ResultatReseau;
    service.generer.and.returnValue(of(r));
    store.onglet = 'controle';
    store.genererControle();
    expect(service.generer.calls.mostRecent().args[0].points.map(p => p.nom_point)).toEqual(['A', 'B', 'C']);
    expect(store.varianteActive).toBe('delaunay');
    const vue = store.construireVue()!;
    expect(vue.lignes.length).toBe(1);
    expect(vue.points.find(p => p.nom_point === 'A')!.marque).toBeTrue();
    expect(vue.points.find(p => p.nom_point === 'D')!.style).toBe('ecarte');

    store.ecarterSuggestion(r.suppressions[0]);
    expect(store.anciens[0].retenu).toBeFalse();
    expect(store.anciens[0].motifEcart).toBe('Doublon');
    expect(store.controlePerime).toBeTrue();
  });

  it('refuse le calcul avec moins de 3 points retenus', () => {
    store.definirAnciens(pts3.slice(0, 2), '');
    expect(store.blocageControle).toContain('3 points');
    store.genererControle();
    expect(service.generer).not.toHaveBeenCalled();
  });

  it('analyse les écarts avec la tolérance en mètres puis reporte la détection', () => {
    store.definirAnciens(pts3, '');
    const analyse = {
      tolerance_m: 0.12, lignes: [{ nom_point_fixe: 'A', nom_point_calcule: 'D', delta_d_m: 0.3, hors_tolerance: true }],
      points: ['A', 'B', 'D'].map(n => ({ nom_point: n })), homogenes: ['A', 'B'], non_homogenes: ['D'],
      non_controles: ['C'], nb_lignes: 1, nb_hors_tolerance: 1, conclusion: '',
    } as unknown as AnalyseEcarts;
    service.analyserEcarts.and.returnValue(of(analyse));
    store.definirRc([{ nom_point_fixe: 'A', nom_point_calcule: 'D', delta_d_m: '0,30' }], 'rc.csv');
    store.analyserEcarts();
    expect(service.analyserEcarts.calls.mostRecent().args[1]).toBeCloseTo(0.12, 6);
    expect(store.anciens.map(a => a.homogene)).toEqual([true, true, null, false]);
    expect(store.nbHomogenes).toBe(2);
    store.onglet = 'ecarts';
    const vue = store.construireVue()!;
    expect(vue.points.map(p => p.style)).toEqual(['homogene', 'homogene', 'non_controle', 'non_homogene']);
    expect(vue.lignes.length).toBe(1);
    expect(vue.lignes[0].style).toBe('incompatible');
    // Ajustement manuel.
    store.basculerHomogene(store.anciens[2]);
    expect(store.nbHomogenes).toBe(3);
  });

  it('densifie avec les seuls anciens homogènes et garde les points manuels', () => {
    store.definirAnciens(pts3, '');
    store.anciens.forEach((a, i) => a.homogene = i < 3);
    store.ajouterNouveau(421000, 381000);
    store.ajouterNouveau(); // sans coordonnées : non envoyé
    const res = {
      points: [
        ...pts3.slice(0, 3).map((p, i) => ({ ...p, index: i, lat: 34, lon: -6, degre: 2, statut: 'ancien' })),
        { nom_point: 'PN1', x_m: 421000, y_m: 381000, index: 3, lat: 34, lon: -6, degre: 3, statut: 'nouveau', origine: 'manuel' },
        { nom_point: 'PN3', x_m: 422000.123, y_m: 381500, index: 4, lat: 34, lon: -6, degre: 3, statut: 'nouveau', origine: 'propose' },
      ],
      proposes: [4], reseau: { lignes: [], triangles: [], controles: [], indicateurs: {} }, score: 90, score_reseau: 88,
      couverture: { taux: 1, rayon_km: 5, points_min: 3, nb_echantillons: 10, pas_m: 100, non_couverts: [] },
      zone_polygone: [[34, -6]], conclusion: '',
    } as unknown as ResultatDensification;
    service.densifier.and.returnValue(of(res));
    store.nbNouveaux = 1;
    store.proposerNouveaux();
    const demande = service.densifier.calls.mostRecent().args[0];
    expect(demande.anciens.map(p => p.nom_point)).toEqual(['A', 'B', 'C']);
    expect(demande.nouveaux.length).toBe(1);
    expect(demande.nouveaux[0].origine).toBe('manuel');
    expect(demande.proposer).toBeTrue();
    expect(store.nouveaux.map(n => n.origine)).toEqual(['manuel', 'propose']);
    expect(store.nouveaux[1].x_m).toBe(422000.12);
    store.onglet = 'densification';
    const vue = store.construireVue()!;
    expect(vue.zone).toEqual([[34, -6]]);
    expect(vue.points.map(p => p.style)).toEqual(['homogene', 'homogene', 'homogene', 'nouveau', 'propose']);

    store.supprimerNouveau(1);
    expect(store.densificationPerimee).toBeTrue();
    store.recalculerDensification();
    expect(service.densifier.calls.mostRecent().args[0].proposer).toBeFalse();
  });

  it('sans contrôle des écarts, tous les anciens retenus servent d\'appui', () => {
    store.definirAnciens(pts3, '');
    expect(store.sansControleEcarts).toBeTrue();
    expect(store.anciensDensification.length).toBe(4);
  });

  it('place un point nouveau au clic (conversion WGS84 → Lambert)', () => {
    store.ajouterNouveauDepuisCarte(34.015908783935465, -6.264760093280916);
    expect(store.nouveaux[0].x_m).toBeCloseTo(420000, 1);
    expect(store.nouveaux[0].y_m).toBeCloseTo(380000, 1);
    expect(store.nouveaux[0].nom_point).toBe('PN1');
  });

  it('remonte les erreurs du serveur', () => {
    store.definirAnciens(pts3, '');
    service.densifier.and.returnValue(throwError(() => ({ error: { detail: 'Alignés' } })));
    store.proposerNouveaux();
    expect(store.erreurDensification).toBe('Alignés');
    expect(store.calculDensification).toBeFalse();
  });

  it('gère mes fonds : catalogue, retrait, personnalisé, persistance', () => {
    store.retirerFond('osm');
    expect(store.listeFonds).toEqual([]);
    expect(store.fondActif).toBeNull();
    store.ajouterFondCatalogue('osm');
    const perso = store.ajouterFondPersonnel({ nom: 'Mien', type: 'xyz', url: 'https://m/{z}/{x}/{y}.png' });
    expect(store.listeFonds.map(f => f.id)).toEqual(['osm', perso.id]);
    expect(store.fondActif?.id).toBe(perso.id);
    expect(JSON.parse(localStorage.getItem(CLE_MES_FONDS)!).persos.length).toBe(1);
  });

  it('renvoie le même objet fond tant que rien ne change (sinon boucle de détection)', () => {
    const a = store.fondActif;
    expect(store.fondActif).toBe(a);
    expect(store.listeFonds).toBe(store.listeFonds);
    store.choisirFond('osm');
    expect(store.listeFonds.length).toBe(1);
  });

  it('l\'onglet des fonds garde la vue de l\'onglet précédent', () => {
    store.definirAnciens(pts3, '');
    const avant = store.vue$.value;
    store.choisirOnglet('fonds');
    expect(store.vue$.value).toBe(avant);
  });
});
