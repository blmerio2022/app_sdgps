import { of, throwError } from 'rxjs';
import { ReseauGpsService } from '../../core/services/reseau-gps.service';
import { ToastService } from '../../core/services/toast.service';
import { CLE_AUTOSAUVEGARDE, ReseauGpsStore } from './reseau-gps.store';
import { CLE_MES_FONDS } from './fonds-carte';
import { RgSelectionComponent } from './onglets/rg-selection.component';
import { RgEtudesComponent, grouperEtudes, nomDeFichier } from './onglets/rg-etudes.component';

const pts = [
  { nom_point: 'A', x_m: 420000, y_m: 380000 }, { nom_point: 'B', x_m: 423000, y_m: 380000 },
  { nom_point: 'C', x_m: 421500, y_m: 382600 }, { nom_point: 'D', x_m: 421500, y_m: 381000 },
];
const carre = [[34.0, -6.3], [34.0, -6.2], [34.05, -6.2], [34.05, -6.3]];

function creer() {
  const service = jasmine.createSpyObj('ReseauGpsService', ['referentiel', 'evaluer', 'densifier', 'genererZone', 'etude',
    'creerEtude', 'modifierEtude', 'etudes', 'supprimerEtude', 'dupliquerEtude']) as jasmine.SpyObj<ReseauGpsService>;
  service.referentiel.and.returnValue(of(null as any));
  service.evaluer.and.returnValue(of({ indicateurs: { score: 50 }, controles: [], lignes: [], triangles: [], points: [] } as any));
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']) as jasmine.SpyObj<ToastService>;
  const store = new ReseauGpsStore(service, toast);
  return { store, service, toast };
}

describe('Sélection et actions en masse', () => {
  let store: ReseauGpsStore;

  beforeEach(() => {
    ({ store } = creer());
    store.definirAnciens(pts as any, 'x');
    store.ajouterNouveau(421000, 381500);
  });

  it('remplacer / ajouter / retirer, sélection complète et inversée', () => {
    store.appliquerSelection({ points: ['A', 'B'], lignes: [['B', 'A']], mode: 'remplacer' });
    expect(store.nomsSelectionnes).toEqual(['A', 'B']);
    expect(store.lignesSelectionnees).toEqual([['A', 'B']]);
    store.appliquerSelection({ points: ['C'], lignes: [], mode: 'ajouter' });
    store.appliquerSelection({ points: ['A'], lignes: [], mode: 'retirer' });
    expect(store.nomsSelectionnes.sort()).toEqual(['B', 'C']);
    expect(store.construireVue()!.selectionnes!.sort()).toEqual(['B', 'C']);
    store.selectionnerTout();
    expect(store.nomsSelectionnes.length).toBe(4);              // les points affichés (onglet points)
    store.selectionnerTout(true);
    expect(store.nomsSelectionnes.length).toBe(0);
    store.appliquerSelection({ points: ['A'], lignes: [], mode: 'remplacer' });
    store.viderSelection();
    expect(store.selection.size).toBe(0);
  });

  it('active / désactive, marque homogène, supprime ; un point disparu quitte la sélection', () => {
    store.appliquerSelection({ points: ['A', 'B', 'PN1'], lignes: [], mode: 'remplacer' });
    expect(store.anciensSelectionnes.length).toBe(2);
    expect(store.nouveauxSelectionnes.length).toBe(1);
    store.activerSelection(false);
    expect(store.anciensRetenus.map(a => a.nom_point)).toEqual(['C', 'D']);
    store.activerSelection(true);
    store.marquerHomogeneSelection(false);
    expect(store.anciens.find(a => a.nom_point === 'A')!.homogene).toBeFalse();
    expect(store.supprimerSelection()).toBe(3);
    expect(store.anciens.map(a => a.nom_point)).toEqual(['C', 'D']);
    expect(store.nouveaux.length).toBe(0);
    store.appliquerSelection({ points: ['C'], lignes: [], mode: 'remplacer' });
    store.supprimerAncien(0);                                    // C retiré par la liste
    expect(store.selection.has('p:C')).toBeFalse();
  });

  it('relie les points sélectionnés puis retire les lignes sélectionnées (réseau personnalisé)', () => {
    store.choisirOnglet('controle');
    store.appliquerSelection({ points: ['A', 'B', 'C'], lignes: [], mode: 'remplacer' });
    expect(store.relierSelection()).toBe(3);                    // triangle A-B-C
    expect(store.perso.controle!.lignes.length).toBe(3);
    expect(store.relierSelection()).toBe(0);
    store.appliquerSelection({ points: [], lignes: [['A', 'B']], mode: 'remplacer' });
    expect(store.retirerLignesSelection()).toBe(1);
    expect(store.aLaLigne('controle', 'A', 'B')).toBeFalse();
  });

  it('exporte la sélection en CSV (BOM, « ; ») et demande le recadrage', () => {
    store.appliquerSelection({ points: ['A', 'PN1'], lignes: [], mode: 'remplacer' });
    const csv = store.selectionEnCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"A";"420000";"380000"');
    expect(csv).toContain('"nouveau"');
    store.cadrerSurSelection();
    expect(store.cadrerNoms$.value).toEqual(['A', 'PN1']);
  });

  it('panneau : ne garder que la sélection, générer depuis la sélection', () => {
    const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const cmp = new RgSelectionComponent(store, toast);
    store.appliquerSelection({ points: ['A', 'B', 'C'], lignes: [], mode: 'remplacer' });
    expect(cmp.total).toBe(3);
    cmp.garderSeulement();
    expect(store.anciensRetenus.map(a => a.nom_point)).toEqual(['A', 'B', 'C']);
    cmp.genererDepuisSelection();
    expect(store.paramZone.source).toBe('selection');
    expect(store.onglet).toBe('controle');
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.supprimer();
    expect(store.anciens.length).toBe(1);
  });
});

describe('Génération d’un réseau pour une zone', () => {
  let store: ReseauGpsStore;
  let service: jasmine.SpyObj<ReseauGpsService>;

  const resultat = (mode: 'triangulation' | 'densification') => ({
    mode, nom_zone: 'Zone 1', anciens_retenus: ['A', 'B', 'C'], nb_candidats: 4, ignores: [], quadrants: ['nord-est'],
    part_zone_encadree: 0.9, score_anciens: 70, score: 80, conclusion: 'ok',
    details: [{ nom_point: 'D', retenu: false, motif: "N'améliore pas le réseau de la zone.", distance_zone_m: 10, dans_zone: false }],
    reseau: mode === 'triangulation' ? {
      points: pts.slice(0, 3).map((p, i) => ({ ...p, index: i, lat: 34, lon: -6, degre: 2 })), recommandee: 'delaunay',
      variantes: [{ code: 'delaunay', nom: 'D', recommandee: true, degres: [2, 2, 2], lignes: [], triangles: [], indicateurs: { score: 80 } }],
      parfaite: { points: [], suggestions: [] }, suppressions: [], justification: [],
    } : undefined,
    densification: mode === 'densification' ? {
      score: 80, points: [...pts.slice(0, 3).map((p, i) => ({ ...p, index: i, lat: 34, lon: -6, degre: 2, statut: 'ancien' })),
                          { nom_point: 'PN1', x_m: 421000.123, y_m: 381000.456, statut: 'nouveau', origine: 'propose', lat: 34, lon: -6 }],
      reseau: { lignes: [], triangles: [] }, couverture: { non_couverts: [] },
    } : undefined,
  } as any);

  beforeEach(() => {
    ({ store, service } = creer());
    store.definirAnciens(pts as any, 'x');
    store.ajouterZoneDessinee(carre);
  });

  it('bloque sans zone ou sans sélection, puis envoie les points de la source et la zone en Lambert', () => {
    store.paramZone.zoneId = null;
    expect(store.blocageZone).toContain('Choisissez la zone');
    store.preparerGenerationZone(store.zones[0].id);
    store.paramZone.source = 'selection';
    expect(store.blocageZone).toContain('Aucun point ancien sélectionné');
    store.appliquerSelection({ points: ['A', 'B', 'C'], lignes: [], mode: 'remplacer' });
    expect(store.blocageZone).toBeNull();
    service.genererZone.and.returnValue(of(resultat('triangulation')));
    store.paramZone.mode = 'triangulation';
    store.genererPourZone();
    const d = service.genererZone.calls.mostRecent().args[0];
    expect(d.anciens.map(p => p.nom_point)).toEqual(['A', 'B', 'C']);
    expect(d.mode).toBe('triangulation');
    expect(d.nom_zone).toBe('Zone 1');
    expect(d.zones[0][0][0][0]).toBeGreaterThan(300000);
    expect(store.construireVue()!.points.length).toBe(4);       // aperçu : 3 retenus + D estompé
  });

  it('appliquer une triangulation : seuls les retenus restent actifs, le réseau ouvre le contrôle', () => {
    store.preparerGenerationZone(store.zones[0].id);
    service.genererZone.and.returnValue(of(resultat('triangulation')));
    store.genererPourZone();
    store.appliquerResultatZone();
    expect(store.anciensRetenus.map(a => a.nom_point)).toEqual(['A', 'B', 'C']);
    expect(store.anciens.find(a => a.nom_point === 'D')!.motifEcart).toContain('améliore');
    expect(store.onglet).toBe('controle');
    expect(store.controle).toBeTruthy();
    expect(store.varianteActive).toBe('delaunay');
  });

  it('appliquer une densification : points nouveaux repris (arrondis), onglet densification', () => {
    store.preparerGenerationZone(store.zones[0].id);
    service.genererZone.and.returnValue(of(resultat('densification')));
    store.genererPourZone();
    store.appliquerResultatZone();
    expect(store.nouveaux.map(n => [n.nom_point, n.x_m, n.origine])).toEqual([['PN1', 421000.12, 'propose']]);
    expect(store.onglet).toBe('densification');
    expect(store.densificationPerimee).toBeFalse();
  });

  it('erreur du serveur affichée ; abandon du résultat', () => {
    store.preparerGenerationZone(store.zones[0].id);
    service.genererZone.and.returnValue(throwError(() => ({ error: { detail: 'Élargissez le rayon.' } })));
    store.genererPourZone();
    expect(store.erreurZone).toBe('Élargissez le rayon.');
    service.genererZone.and.returnValue(of(resultat('triangulation')));
    store.genererPourZone();
    store.abandonnerResultatZone();
    expect(store.resultatZone).toBeNull();
  });
});

describe('Études enregistrées', () => {
  let store: ReseauGpsStore;
  let service: jasmine.SpyObj<ReseauGpsService>;
  const etude = { id: 'e1', nom: 'Azilal', dossier: 'Nord', description: '', epinglee: false, version_schema: 1,
                  nb_points: 4, nb_zones: 1, nb_nouveaux: 0, taille: 10, created_at: '2026-11-23T10:00:00Z',
                  updated_at: '2026-11-23T10:00:00Z', created_by_email: null, updated_by_email: null };

  beforeEach(() => {
    localStorage.removeItem(CLE_AUTOSAUVEGARDE);
    localStorage.removeItem(CLE_MES_FONDS);
    ({ store, service } = creer());
  });
  afterEach(() => { localStorage.removeItem(CLE_AUTOSAUVEGARDE); localStorage.removeItem(CLE_MES_FONDS); });

  it('sérialise puis restaure tout l’espace de travail', () => {
    store.definirAnciens(pts as any, 'lpa.csv');
    store.basculerRetenu(store.anciens[3]);
    store.ajouterZoneDessinee(carre);
    store.ajouterNouveau(421000, 381500);
    store.longueurMaxKm = 15;
    store.choisirOnglet('controle');
    store.personnaliser('controle');
    store.ajouterLigne('controle', 'A', 'B');
    const contenu = JSON.parse(JSON.stringify(store.serialiser()));
    const autre = creer().store;
    autre.restaurer(contenu);
    expect(autre.anciens.length).toBe(4);
    expect(autre.anciensRetenus.length).toBe(3);
    expect(autre.zones[0].nom).toBe('Zone 1');
    expect(autre.nouveaux.length).toBe(1);
    expect(autre.longueurMaxKm).toBe(15);
    expect(autre.onglet).toBe('controle');
    expect(autre.perso.controle!.lignes).toEqual([['A', 'B']]);
    expect(autre.modifie).toBeFalse();
  });

  it('crée l’étude, puis enregistre automatiquement les modifications (différé)', () => {
    jasmine.clock().install();
    try {
      service.creerEtude.and.returnValue(of(etude as any));
      service.modifierEtude.and.returnValue(of(etude as any));
      store.definirAnciens(pts as any, 'x');
      store.enregistrer();                                       // sans étude ni nom : rien
      expect(service.creerEtude).not.toHaveBeenCalled();
      store.enregistrer({ nom: 'Azilal', dossier: 'Nord' });
      expect(service.creerEtude.calls.mostRecent().args[0].contenu!['anciens'].length).toBe(4);
      expect(store.etude!.id).toBe('e1');
      expect(store.modifie).toBeFalse();
      store.ajouterZoneDessinee(carre);
      expect(store.modifie).toBeTrue();
      jasmine.clock().tick(3000);
      expect(service.modifierEtude).toHaveBeenCalledWith('e1', jasmine.objectContaining({ contenu: jasmine.any(Object) }));
      store.basculerAutosauvegarde(false);
      store.ajouterZoneDessinee(carre);
      jasmine.clock().tick(3000);
      expect(service.modifierEtude).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(CLE_AUTOSAUVEGARDE)).toBe('0');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('ouvre une étude (fonds personnalisés fusionnés), repart à vide, exporte et réimporte', () => {
    service.etude.and.returnValue(of({ ...etude, contenu: { anciens: pts, zones: [], onglet: 'zones',
      mesFonds: { ids: [], actif: null, persos: [{ id: 'p1', nom: 'Ortho', type: 'xyz', url: 'https://o/{z}/{x}/{y}' }] } } } as any));
    store.ouvrirEtude('e1');
    expect(store.etude!.nom).toBe('Azilal');
    expect(store.anciens.length).toBe(4);
    expect(store.onglet).toBe('zones');
    expect(store.mesFonds.persos.map(f => f.nom)).toContain('Ortho');
    const fichier = store.exporterEtude();
    store.nouvelleEtude();
    expect(store.etude).toBeNull();
    expect(store.anciens.length).toBe(0);
    expect(store.importerEtude(fichier)).toBeTrue();
    expect(store.anciens.length).toBe(4);
    expect(store.modifie).toBeTrue();
    expect(store.importerEtude('{"format":"autre"}')).toBeFalse();
  });

  it('panneau : groupes par dossier (épinglées en tête), statut, enregistrer sous', () => {
    const groupes = grouperEtudes([
      { ...etude, id: '1', dossier: '', updated_at: '2026-01-01' },
      { ...etude, id: '2', dossier: 'Nord', updated_at: '2026-01-01' },
      { ...etude, id: '3', dossier: 'Nord', epinglee: true, updated_at: '2025-01-01' },
      { ...etude, id: '4', dossier: 'Atlas', updated_at: '2026-01-02' },
    ] as any);
    expect(groupes.map(g => g.dossier)).toEqual(['Atlas', 'Nord', '']);
    expect(groupes[1].etudes.map(e => e.id)).toEqual(['3', '2']);
    service.etudes.and.returnValue(of({ etudes: [], dossiers: ['Nord'] }));
    service.creerEtude.and.returnValue(of(etude as any));
    const cmp = new RgEtudesComponent(store, service, jasmine.createSpyObj('ToastService', ['success', 'error']));
    expect(cmp.statut).toBe('Aucune étude ouverte');
    store.ajouterZoneDessinee(carre);
    expect(cmp.statut).toBe('Travail non enregistré');
    cmp.enregistrer();                                          // pas d'étude : formulaire
    expect(cmp.formulaire!.nom).toContain('Zone 1');
    cmp.formulaire!.nom = 'Mon étude';
    cmp.validerFormulaire();
    expect(service.creerEtude.calls.mostRecent().args[0].nom).toBe('Mon étude');
    expect(cmp.statut).toContain('Enregistrée');
    expect(cmp.etat).toBe('ok');
  });

  it('panneau : liste STABLE entre deux rafraîchissements (sinon le clic se perd)', () => {
    service.etudes.and.returnValue(of({ etudes: [{ ...etude }, { ...etude, id: 'e2', nom: 'B', dossier: '' }] as any, dossiers: ['Nord'] }));
    const cmp = new RgEtudesComponent(store, service, jasmine.createSpyObj('ToastService', ['success', 'error']));
    cmp.ouvrirPanneau();
    const premiers = cmp.groupes;
    expect(cmp.groupes).toBe(premiers);                          // même tableau, mêmes objets
    expect(cmp.groupes[0].etudes[0]).toBe(premiers[0].etudes[0]);
    expect(cmp.trackEtude(0, cmp.etudes[0])).toBe('e1');
    expect(cmp.trackGroupe(0, cmp.groupes[0])).toBe('Nord');
  });

  it('panneau : ouvrir, renommer, épingler, dupliquer, supprimer (confirmation sur place), exporter', () => {
    const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    service.etudes.and.returnValue(of({ etudes: [{ ...etude }] as any, dossiers: [] }));
    service.etude.and.returnValue(of({ ...etude, contenu: { anciens: pts, zones: [] } } as any));
    const cmp = new RgEtudesComponent(store, service, toast);
    cmp.ouvrirPanneau();
    cmp.ouvrir(cmp.etudes[0]);
    expect(store.etude!.id).toBe('e1');
    expect(store.anciens.length).toBe(4);
    expect(cmp.ouvert).toBeFalse();                             // fermé une fois l'étude chargée
    // Ouverture en échec : le panneau reste ouvert.
    cmp.ouvrirPanneau();
    service.etude.and.returnValue(throwError(() => ({ error: { detail: 'Étude introuvable.' } })));
    store.etude = null; store.modifie = false;
    cmp.ouvrir(cmp.etudes[0]);
    expect(cmp.ouvert).toBeTrue();
    // Renommer / ranger
    service.modifierEtude.and.returnValue(of({ ...etude, nom: 'Azilal 2', dossier: 'Sud' } as any));
    store.etude = { ...etude } as any;
    cmp.commencerEdition(cmp.etudes[0]);
    cmp.edition!.nom = ' Azilal 2 '; cmp.edition!.dossier = 'Sud';
    cmp.validerEdition();
    expect(service.modifierEtude).toHaveBeenCalledWith('e1', { nom: 'Azilal 2', dossier: 'Sud', description: '' });
    expect(store.etude!.nom).toBe('Azilal 2');
    expect(cmp.edition).toBeNull();
    // Épingler, dupliquer
    cmp.epingler(cmp.etudes[0]);
    expect(service.modifierEtude.calls.mostRecent().args[1]).toEqual({ epinglee: true });
    service.dupliquerEtude.and.returnValue(of({ ...etude, id: 'e3', nom: 'Azilal (copie)' } as any));
    cmp.dupliquer(cmp.etudes[0]);
    expect(service.dupliquerEtude).toHaveBeenCalledWith('e1');
    // Supprimer : d'abord une confirmation sur place, puis la suppression ; l'étude ouverte est fermée.
    service.supprimerEtude.and.returnValue(of(undefined as any));
    cmp.demanderSuppression(cmp.etudes[0]);
    expect(cmp.aSupprimer).toBe('e1');
    expect(service.supprimerEtude).not.toHaveBeenCalled();
    cmp.supprimer(cmp.etudes[0]);
    expect(service.supprimerEtude).toHaveBeenCalledWith('e1');
    expect(cmp.aSupprimer).toBeNull();
    expect(store.etude).toBeNull();
    // Exporter une étude de la liste sans l'ouvrir
    service.etude.and.returnValue(of({ ...etude, nom: 'Étude Aït-Ali', contenu: { anciens: [] } } as any));
    const clic = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.exporterEtude(cmp.etudes[0]);
    expect(clic).toHaveBeenCalled();
    expect(nomDeFichier('Étude Aït-Ali / 2026')).toBe('Etude_Ait-Ali_2026');
  });
});

describe('Cycle de contrôle de stabilité et d’homogénéité', () => {
  let store: ReseauGpsStore;
  let service: jasmine.SpyObj<ReseauGpsService>;

  const controle = (noms: string[]) => ({
    points: noms.map((n, i) => ({ ...pts.find(p => p.nom_point === n)!, index: i, lat: 34, lon: -6, degre: 2 })),
    recommandee: 'delaunay', justification: [], suppressions: [],
    variantes: [{ code: 'delaunay', nom: 'Delaunay', recommandee: true, degres: noms.map(() => 2), triangles: [],
                  indicateurs: { score: 70 },
                  lignes: noms.slice(1).map((_, k) => ({ de: k, a: k + 1, distance_m: 1, distance_km: 0.001, azimut_deg: 0,
                                                         en_boucle: true, trop_longue: false })) }],
    parfaite: { code: 'parfaite', points: [], suggestions: [], lignes: [], triangles: [], indicateurs: { score: 80 } },
  } as any);

  beforeEach(() => {
    ({ store, service } = creer());
    store.definirAnciens(pts as any, 'x');
  });

  it('la première zone devient la zone d’étude, et la cible du générateur', () => {
    store.ajouterZoneDessinee(carre);
    expect(store.zoneEtudeId).toBe(store.zones[0].id);
    expect(store.paramZone.zoneId).toBe(store.zones[0].id);
    store.ajouterZoneDessinee(carre);
    expect(store.zoneEtudeId).toBe(store.zones[0].id);           // la première reste la zone d'étude
    store.definirZoneEtude(store.zones[1].id);
    expect(store.zoneEtude!.nom).toBe('Zone 2');
    store.supprimerZone(store.zones[1].id);
    expect(store.zoneEtudeId).toBe(store.zones[0].id);
    store.preparerGenerationZone(store.zones[0].id);
    expect(store.onglet).toBe('controle');
    expect(store.paramZone.mode).toBe('triangulation');
  });

  it('itérations : arrêt, observation, lignes complémentaires et exports CSV', () => {
    store.choisirOnglet('controle');
    expect(store.blocageArret).toContain('Générez');
    store.controle = controle(['A', 'B', 'C']);
    store.controlePerime = false;
    store.varianteActive = 'parfaite';
    expect(store.blocageArret).toContain('variante parfaite');
    store.varianteActive = 'delaunay';
    const it1 = store.arreterReseau('Campagne 1')!;
    expect([it1.numero, it1.lignes, it1.points, it1.statut]).toEqual([1, [['A', 'B'], ['B', 'C']], ['A', 'B', 'C'], 'a_observer']);
    store.marquerObservee(it1);
    store.controle = controle(['A', 'B', 'C', 'D']);              // D ajouté : B-C déjà observée, C-D nouvelle
    const it2 = store.arreterReseau()!;
    expect(store.lignesComplementaires(it2)).toEqual([['C', 'D']]);
    expect(store.construireVue()!.lignesAObserver).toEqual(['C\u0000D']);
    const lignes = store.csvIteration(it2, 'lignes');
    expect(lignes).toContain('"C";"D"');
    expect(lignes).toContain('"Oui"');
    expect(lignes).toContain('"Non (déjà observée)"');
    expect(store.csvIteration(it2, 'points')).toContain('"À contrôler"');
    store.supprimerIteration(it1);
    expect(store.iterations.map(i => i.numero)).toEqual([1]);
  });

  it('qualification, désactivation des non conformes, validation du groupe homogène', () => {
    const [a, b, c, d] = store.anciens;
    store.qualifier(a, 'homogene'); store.qualifier(b, 'homogene');
    store.qualifier(c, 'instable'); store.qualifier(d, 'non_retrouve');
    expect([c.homogene, store.qualiteDe(c)]).toEqual([false, 'instable']);
    expect(store.compteQualites().homogene).toBe(2);
    expect(store.blocageGroupe).toContain('au moins 3');
    expect(store.desactiverNonConformes()).toBe(2);
    expect(store.anciensRetenus.map(x => x.nom_point)).toEqual(['A', 'B']);
    expect(c.motifEcart).toBe('Instable');
    store.basculerRetenu(c);
    store.qualifier(c, 'homogene');
    store.validerGroupeHomogene();
    expect(store.groupeHomogene!.points).toEqual(['A', 'B', 'C']);
    expect(store.onglet).toBe('densification');
    expect(store.anciensDensification.map(x => x.nom_point)).toEqual(['A', 'B', 'C']);
    store.qualifier(b, 'non_homogene');
    expect(store.groupeAltere).toEqual(['B']);
    store.annulerGroupeHomogene();
    expect(store.groupeHomogene).toBeNull();
    const contenu = JSON.parse(JSON.stringify(store.serialiser()));
    const autre = creer().store;
    autre.restaurer(contenu);
    expect(autre.anciens.find(x => x.nom_point === 'C')!.qualite).toBe('homogene');
  });

  it('points nouveaux : rayon et emplacement proposé, déplacement, sortie du rayon, recentrage', () => {
    jasmine.clock().install();
    try {
      service.densifier.and.returnValue(of({
        score: 90, reseau: { lignes: [], triangles: [] }, couverture: { non_couverts: [] },
        points: [...pts.map((p, i) => ({ ...p, index: i, statut: 'ancien', lat: 34, lon: -6 })),
                 { nom_point: 'PN1', x_m: 421000, y_m: 381000, statut: 'nouveau', origine: 'propose', lat: 34, lon: -6,
                   rayon_deplacement_m: 200 }],
      } as any));
      store.proposerNouveaux();
      const n = store.nouveaux[0];
      expect([n.rayon_m, n.ancre]).toEqual([200, { x_m: 421000, y_m: 381000 }]);
      store.choisirOnglet('densification');
      const vue = store.construireVue()!;
      expect(vue.cercles![0].rayon_m).toBe(200);
      expect(vue.deplacables).toEqual(['PN1']);
      // À ~300 m de l'emplacement proposé : sorti du rayon ; un déplacement sur la carte relance le calcul.
      n.x_m = 421300;
      expect(Math.round(store.ecartAncre(n)!)).toBe(300);
      expect(store.horsRayon(n)).toBeTrue();
      service.densifier.calls.reset();
      store.deplacerNouveau('PN1', 34.0, -6.3);
      jasmine.clock().tick(500);
      expect(service.densifier).toHaveBeenCalledTimes(1);
      expect(service.densifier.calls.mostRecent().args[0].rayons).toBeUndefined();
      expect(store.nouveaux[0].rayon_m).toBe(200);                    // nouveau rayon renvoyé → ancre remise à jour
      store.nouveaux[0].x_m = 421100;
      store.recentrer(store.nouveaux[0]);
      expect(store.ecartAncre(store.nouveaux[0])).toBe(0);
      store.calculerRayons();
      expect(service.densifier.calls.mostRecent().args[0].rayons).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

