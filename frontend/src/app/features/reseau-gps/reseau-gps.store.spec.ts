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
      ['referentiel', 'generer', 'sourcesLpa', 'sourceLpa', 'analyserEcarts', 'sourcesRc', 'sourceRc', 'densifier',
       'evaluer', 'importerZones']);
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

  it('lit les coordonnées des pièces écrites avec espaces ou virgule (« 353 108.16 »)', () => {
    store.definirAnciens([{ nom_point: 'A', x_m: '353 108.16' as any, y_m: '146\u00a0858,01' as any },
                          { nom_point: 'B', x_m: 'x' as any, y_m: null }], 'lpa');
    expect([store.anciens[0].x_m, store.anciens[0].y_m]).toEqual([353108.16, 146858.01]);
    expect(store.anciens[1].x_m).toBeNull();
    expect(store.anciensRetenus.length).toBe(1);
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

  // ------------------------------------------------------------------ activation des points

  it('active, désactive ou inverse tous les points ; bascule depuis la carte', () => {
    store.definirAnciens(pts3, 'x');
    store.activerTous(false);
    expect(store.anciensRetenus.length).toBe(0);
    store.activerTous('inverser');
    expect(store.anciensRetenus.length).toBe(4);
    store.basculerRetenuParNom('B');
    expect(store.anciens.find(a => a.nom_point === 'B')!.retenu).toBeFalse();
    expect(store.anciens.find(a => a.nom_point === 'B')!.motifEcart).toContain('carte');
    store.basculerRetenuParNom('inconnu');
    expect(store.nbEcartes).toBe(1);
  });

  // ------------------------------------------------------------------ zones

  const carre = [[34.0, -6.3], [34.0, -6.2], [34.05, -6.2], [34.05, -6.3]];

  it('importe des zones (type par défaut, référence reprise des attributs) et prévient', () => {
    service.importerZones.and.returnValue(of({
      zones: [{ nom: 'Lot 1', type: 'levee', type_deduit: true, attributs: { REF: 'T-12', NOM: 'Lot 1' },
                polygones: [[carre]], couche: 'lots', fichier: 'lots.shp' },
              { nom: 'Lot 2', type: null, type_deduit: false, attributs: {}, polygones: [[carre]],
                couche: 'secteurs', fichier: 'etude.gpkg' }],
      projections: [{ couche: 'lots', code: 'nord', libelle: 'Lambert Nord', supposee: true }], avertissements: ['x'],
    } as any));
    const fichier = new File(['x'], 'lots.zip');
    store.importerZones([fichier], 'densification');
    expect(service.importerZones).toHaveBeenCalledWith([fichier], 'nord', 'densification');
    expect(store.zones.map(z => [z.nom, z.type, z.reference])).toEqual([['Lot 1', 'levee', 'T-12'], ['Lot 2', 'densification', '']]);
    expect(store.zones[1].fichier).toBe('etude.gpkg › secteurs');
    expect(store.avertissementsZones.length).toBe(2);
    expect(toast.success.calls.mostRecent().args[1]).toContain('1 dont le type est à vérifier');
    expect(store.cadrerZones$.value?.length).toBe(2);
    expect(store.construireVue()!.zones!.length).toBe(2);         // zones affichées même sans point
  });

  it('dessine une zone, change son type (et sa couleur), la mesure puis la supprime', () => {
    store.typeDessin = 'levee';
    store.commencerDessinZone();
    expect(store.modeDessinZone).toBeTrue();
    store.ajouterZoneDessinee(carre);
    const z = store.zones[0];
    expect([z.nom, z.type, z.couleur, store.onglet, store.modeDessinZone]).toEqual(['Zone 1', 'levee', '#f39c12', 'zones', false]);
    expect(store.zoneSelectionnee).toBe(z.id);
    store.changerTypeZone(z, 'densification');
    expect(z.couleur).toBe('#8e44ad');
    const m = store.mesuresZone(z);
    expect(m.aire).toBeGreaterThan(40e6);                         // ~ 9,2 km × 5,5 km
    expect(m.sommets).toBe(4);
    store.ajouterZoneDessinee([[34, -6], [34.1, -6]]);           // moins de 3 sommets : ignorée
    expect(store.zones.length).toBe(1);
    store.supprimerZone(z.id);
    expect(store.zones.length).toBe(0);
  });

  it('transmet les zones actives (en Lambert) à la densification et exporte en GeoJSON', () => {
    store.ajouterZoneDessinee(carre);
    store.typeDessin = 'levee';
    store.ajouterZoneDessinee(carre);
    store.zones[1].active = false;
    const calc = store.zonesPourCalcul();
    expect(calc.zones_densification.length).toBe(1);
    expect(calc.zones_levee.length).toBe(0);
    expect(calc.zones_densification[0][0][0][0]).toBeGreaterThan(300000);       // X Lambert
    store.definirAnciens(pts3, 'x');
    service.densifier.and.returnValue(of({ points: [], reseau: { lignes: [], triangles: [] }, couverture: {} } as any));
    store.proposerNouveaux();
    expect(service.densifier.calls.mostRecent().args[0].zones_densification!.length).toBe(1);
    const geo = JSON.parse(store.exporterGeoJson());
    expect(geo.features.length).toBe(2);
    expect(geo.features[0].geometry.coordinates[0][0][0]).toEqual([-6.3, 34.0]);  // lon, lat ; anneau fermé
    expect(geo.features[0].geometry.coordinates[0][0].length).toBe(5);
  });

  // ------------------------------------------------------------------ réseau personnalisé

  it('personnalise le réseau de contrôle : lignes reprises, ajout / retrait / modification, évaluation différée', () => {
    jasmine.clock().install();
    try {
      store.definirAnciens(pts3, 'x');
      service.generer.and.returnValue(of({
        points: pts3.map((p, i) => ({ ...p, index: i, lat: 34, lon: -6, degre: 2 })),
        variantes: [variante('delaunay', 80)], recommandee: 'delaunay', justification: [], suppressions: [],
        parfaite: { ...variante('parfaite', 90), points: [], suggestions: [], conclusion: '' },
      } as unknown as ResultatReseau));
      store.genererControle();
      service.evaluer.and.returnValue(of({ ...variante('personnalise', 70), points: [] } as any));
      store.personnaliser('controle');
      expect(store.perso.controle!.lignes).toEqual([['A', 'B']]);
      expect(store.varianteActive).toBe('personnalise');
      expect(service.evaluer).toHaveBeenCalledTimes(1);                       // immédiat au démarrage
      expect(store.scorePerso('controle')).toBe(70);

      expect(store.ajouterLigne('controle', 'B', 'A')).toBeFalse();           // doublon (sens indifférent)
      expect(store.ajouterLigne('controle', 'C', 'C')).toBeFalse();
      expect(store.ajouterLigne('controle', 'B', 'C')).toBeTrue();
      store.basculerLigne('controle', 'C', 'A');
      expect(store.perso.controle!.lignes.length).toBe(3);
      expect(store.modifierLigne('controle', 2, 'C', 'D')).toBeTrue();
      expect(store.modifierLigne('controle', 2, 'A', 'B')).toBeFalse();       // existe déjà
      store.supprimerLigne('controle', 0);
      expect(store.perso.controle!.lignes).toEqual([['B', 'C'], ['C', 'D']]);
      expect(service.evaluer).toHaveBeenCalledTimes(1);                       // regroupé…
      jasmine.clock().tick(400);
      expect(service.evaluer).toHaveBeenCalledTimes(2);                       // …en un seul calcul
      expect(service.evaluer.calls.mostRecent().args[0].lignes).toEqual([['B', 'C'], ['C', 'D']]);

      // Désactiver un point retire ses lignes.
      store.basculerRetenu(store.anciens.find(a => a.nom_point === 'D')!);
      expect(store.perso.controle!.lignes).toEqual([['B', 'C']]);
      store.choisirOnglet('controle');
      const vue = store.construireVue()!;
      expect(vue.lignes.length).toBe(1);
      expect(vue.lignes[0].perso).toBeTrue();

      store.abandonnerPerso('controle');
      expect(store.perso.controle).toBeNull();
      expect(store.varianteActive).toBe('delaunay');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('édition sur la carte : point A puis point B bascule la ligne ; clic sur une ligne la retire', () => {
    store.definirAnciens(pts3, 'x');
    service.evaluer.and.returnValue(of({ ...variante('personnalise', 50), points: [] } as any));
    store.commencerEditionLignes('controle');
    expect(store.editionLignes).toBe('controle');
    expect(store.perso.controle!.lignes).toEqual([]);                         // pas de réseau calculé : vide
    store.clicPointEdition('A');
    expect(store.selectionLigne).toBe('A');
    expect(store.construireVue()!.selection).toBe('A');
    store.clicPointEdition('B');
    expect(store.perso.controle!.lignes).toEqual([['A', 'B']]);
    expect(store.selectionLigne).toBeNull();
    store.clicLigneEdition('B', 'A');
    expect(store.perso.controle!.lignes).toEqual([]);
    store.choisirOnglet('points');                                            // changer d'onglet termine l'édition
    expect(store.editionLignes).toBeNull();
  });

  it('réseau personnalisé de densification : indices dans anciens + nouveaux et zones transmis', () => {
    jasmine.clock().install();
    try {
      store.definirAnciens(pts3, 'x');
      store.ajouterNouveau(421000, 381500);
      service.densifier.and.returnValue(of({ score: 77, points: [], reseau: { lignes: [], triangles: [] },
                                             couverture: { non_couverts: [] } } as any));
      store.personnaliser('densification');
      store.ajouterLigne('densification', 'A', 'PN1');
      jasmine.clock().tick(400);
      const demande = service.densifier.calls.mostRecent().args[0];
      expect(demande.proposer).toBeFalse();
      expect(demande.lignes).toEqual([[0, 4]]);
      expect(demande.nouveaux.length).toBe(1);
      expect(store.scorePerso('densification')).toBe(77);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('erreur d\'évaluation affichée, moins de 3 points signalés', () => {
    store.definirAnciens(pts3.slice(0, 2), 'x');
    store.personnaliser('controle');
    expect(store.perso.controle!.erreur).toContain('au moins 3 points');
    store.definirAnciens(pts3, 'x');
    service.evaluer.and.returnValue(throwError(() => ({ error: { detail: 'Point inconnu.' } })));
    store.personnaliser('controle');
    expect(store.perso.controle!.erreur).toBe('Point inconnu.');
  });
});
