import { of } from 'rxjs';
import { OngletZonesComponent } from './onglet-zones.component';
import { RgReseauPersoComponent } from './rg-reseau-perso.component';
import { ReseauGpsStore } from '../reseau-gps.store';

function storeFactice(): ReseauGpsStore {
  const service = jasmine.createSpyObj('ReseauGpsService', ['referentiel', 'evaluer', 'importerZones', 'densifier']);
  service.referentiel.and.returnValue(of(null));
  service.evaluer.and.returnValue(of({ indicateurs: { score: 64, nb_triangles: 1 }, controles: [], admissible: true,
                                       lignes: [], triangles: [], points: [] }));
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  return new ReseauGpsStore(service, toast);
}

const pts = [
  { nom_point: 'A', x_m: 420000, y_m: 380000 }, { nom_point: 'B', x_m: 423000, y_m: 380000 },
  { nom_point: 'C', x_m: 421500, y_m: 382600 },
];

describe('Onglet Zones', () => {
  let store: ReseauGpsStore;
  let cmp: OngletZonesComponent;

  beforeEach(() => {
    store = storeFactice();
    cmp = new OngletZonesComponent(store);
  });

  it('transmet les fichiers et le type par défaut, puis vide le champ', () => {
    const imp = spyOn(store, 'importerZones');
    const input = { files: [new File(['x'], 'a.gpkg')], value: 'a.gpkg' } as any;
    cmp.typeDefautImport = 'levee';
    cmp.importer({ target: input } as any);
    expect(imp).toHaveBeenCalledWith(input.files, 'levee');
    expect(input.value).toBe('');
  });

  it('dessin : type choisi, bascule du mode ; compteurs et surfaces par type', () => {
    cmp.basculerDessin('levee');
    expect(store.modeDessinZone).toBeTrue();
    expect(store.typeDessin).toBe('levee');
    cmp.basculerDessin();
    expect(store.modeDessinZone).toBeFalse();
    store.ajouterZoneDessinee([[34, -6.3], [34, -6.2], [34.05, -6.2]]);
    expect(cmp.nombre('levee')).toBe(1);
    expect(cmp.surfaceTotale('levee')).toBeGreaterThan(0);
    expect(cmp.nombre('densification')).toBe(0);
  });

  it('supprime après confirmation et exporte un fichier GeoJSON', () => {
    store.ajouterZoneDessinee([[34, -6.3], [34, -6.2], [34.05, -6.2]]);
    spyOn(window, 'confirm').and.returnValues(false, true);
    cmp.supprimer(store.zones[0]);
    expect(store.zones.length).toBe(1);
    cmp.supprimer(store.zones[0]);
    expect(store.zones.length).toBe(0);
    store.ajouterZoneDessinee([[34, -6.3], [34, -6.2], [34.05, -6.2]]);
    const clic = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.exporter();
    expect(clic).toHaveBeenCalled();
  });
});

describe('Panneau Réseau personnalisé', () => {
  let store: ReseauGpsStore;
  let cmp: RgReseauPersoComponent;

  beforeEach(() => {
    store = storeFactice();
    store.definirAnciens(pts as any, 'x');
    cmp = new RgReseauPersoComponent(store);
    cmp.contexte = 'controle';
    cmp.scoreReference = 60;
  });

  it('démarre (vide), compare au score de référence, longueurs et N7', () => {
    cmp.personnaliser(true);
    expect(cmp.perso!.lignes).toEqual([]);
    expect(cmp.score).toBe(64);
    expect(cmp.ecart).toBe(4);
    expect(cmp.longueurKm('A', 'B')).toBe(3);
    store.longueurMaxKm = 2;
    expect(cmp.tropLongue('A', 'B')).toBeTrue();
    expect(cmp.longueurKm('A', 'Z')).toBeNull();
  });

  it('ajoute une ligne, refuse une modification en doublon (valeur d\'origine rétablie), édition sur la carte', () => {
    cmp.personnaliser(true);
    cmp.nouvelleA = 'A'; cmp.nouvelleB = 'B';
    cmp.ajouter();
    expect(cmp.perso!.lignes).toEqual([['A', 'B']]);
    expect(cmp.nouvelleB).toBe('');
    cmp.nouvelleB = 'C';
    cmp.ajouter();
    const select = { value: 'B' } as HTMLSelectElement;
    cmp.modifier(1, 1, 'B', select);                       // A–B existe déjà
    expect(select.value).toBe('C');
    cmp.basculerEdition();
    expect(cmp.enEdition).toBeTrue();
    cmp.basculerEdition();
    expect(cmp.enEdition).toBeFalse();
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.abandonner();
    expect(cmp.perso).toBeNull();
  });
});
