import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Input, NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { ReseauGpsPageComponent } from './reseau-gps-page.component';
import { ReseauGpsService, ResultatReseau, VarianteReseau } from '../../../core/services/reseau-gps.service';
import { ToastService } from '../../../core/services/toast.service';
import { CLE_FONDS_PERSONNELS, CLE_FOND_ACTIF } from '../fonds-carte';

@Component({ selector: 'app-reseau-carte', template: '' })
class CarteFactice {
  @Input() vue: any; @Input() fond: any; @Input() etiquettesDistances: any; @Input() afficherTriangles: any;
  recadrer() {}
}

function variante(code: string, score: number, extra: Partial<VarianteReseau> = {}): VarianteReseau {
  return {
    code, nom: code, description: '', admissible: true, recommandee: false,
    indicateurs: {
      nb_points: 3, nb_lignes_base: 3, nb_triangles: 1, angle_min: score / 2, angle_max: 70,
      ecart_equilateral_moyen: 5, taux_triangles_conformes: 1, nb_triangles_defectueux: 0, degre_min: 2,
      degre_moyen: 2, nb_points_sous_liaisons: 0, taux_points_bien_lies: 0, redondance: 1,
      taux_lignes_en_boucle: 1, longueur_max_km: 2, longueur_moyenne_km: 2, longueur_totale_km: 6,
      nb_lignes_trop_longues: 0, lignes_par_point: 1, connexe: true, nb_violations_stations_voisines: 0,
      score, penalite: 0,
    },
    controles: [{ code: 'ANGLES', norme: 'N1', gravite: 'majeur', ok: true, message: 'ok' }],
    lignes: [{ de: 0, a: 1, distance_m: 2000, distance_km: 2, azimut_deg: 90, en_boucle: true, trop_longue: false }],
    triangles: [], degres: [5, 6, 7], violations_stations_voisines: [],
    ...extra,
  };
}

const POINTS = [0, 1, 2].map(i => ({ index: i, nom_point: `P${i}`, x_m: i, y_m: i, lat: 34, lon: -6, degre: 2, statut: 'ancien' as const }));

const RESULTAT: ResultatReseau = {
  type_reseau: 'anciens', zone: 'nord', longueur_max_km: 10, points: POINTS,
  variantes: [variante('delaunay', 60), variante('delaunay_toleree', 80, { recommandee: true })],
  recommandee: 'delaunay_toleree',
  justification: ['Meilleur score'],
  parfaite: { ...variante('parfaite', 90), points: POINTS, suggestions: [], conclusion: 'Rien' },
};

describe('ReseauGpsPageComponent', () => {
  let fixture: ComponentFixture<ReseauGpsPageComponent>;
  let comp: ReseauGpsPageComponent;
  let service: jasmine.SpyObj<ReseauGpsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    localStorage.removeItem(CLE_FONDS_PERSONNELS);
    localStorage.removeItem(CLE_FOND_ACTIF);
    service = jasmine.createSpyObj('ReseauGpsService', ['referentiel', 'generer', 'sourcesLpa', 'sourceLpa']);
    service.referentiel.and.returnValue(of({
      zones: [{ code: 'nord', libelle: 'Nord', epsg: 26191 }, { code: 'sud', libelle: 'Sud', epsg: 26192 }],
      zone_defaut: 'nord', types_reseau: [], variantes: [], normes: [],
      defauts: { longueur_max_km: 10, nb_suggestions_max: 5, points_max: 300, suggestions_max: 15 },
    }));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ReseauGpsPageComponent, CarteFactice],
      providers: [{ provide: ReseauGpsService, useValue: service }, { provide: ToastService, useValue: toast }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(ReseauGpsPageComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(CLE_FONDS_PERSONNELS);
    localStorage.removeItem(CLE_FOND_ACTIF);
  });

  function saisir3Points() {
    comp.points = [
      { nom_point: 'A', x_m: 0, y_m: 0, statut: 'ancien' },
      { nom_point: 'B', x_m: 1000, y_m: 0, statut: 'ancien' },
      { nom_point: 'C', x_m: 500, y_m: 800, statut: 'ancien' },
    ];
  }

  it('applique les valeurs par défaut du référentiel', () => {
    expect(comp.zone).toBe('nord');
    expect(comp.longueurMaxKm).toBe(10);
    expect(comp.fondActifId).toBe('osm');
  });

  it('bloque le calcul tant qu\'il manque des points', () => {
    expect(comp.blocage).toContain('3 points');
    saisir3Points();
    expect(comp.blocage).toBeNull();
    comp.typeReseau = 'mixte';
    expect(comp.blocage).toContain('point nouveau');
  });

  it('ajoute et supprime des points', () => {
    comp.ajouterPoint();
    comp.ajouterPoint();
    expect(comp.points.length).toBe(2);
    comp.supprimerPoint(0);
    expect(comp.points.length).toBe(1);
    expect(comp.points[0].nom_point).toBe('P2');
  });

  it('génère le réseau et affiche la variante recommandée', () => {
    saisir3Points();
    comp.points.push({ nom_point: 'vide', x_m: null, y_m: null });
    service.generer.and.returnValue(of(RESULTAT));
    comp.generer();
    const demande = service.generer.calls.mostRecent().args[0];
    expect(demande.points.length).toBe(3); // la ligne sans coordonnées est écartée
    expect(demande.zone).toBe('nord');
    expect(comp.varianteActive).toBe('delaunay_toleree');
    expect(comp.vue?.points[0].degre).toBe(5); // degrés propres à la variante
    expect(comp.toutesVariantes.length).toBe(3);
  });

  it('affiche la variante parfaite avec ses suggestions', () => {
    comp.resultat = RESULTAT;
    comp.choisirVariante('parfaite');
    expect(comp.vue?.suggestions).toEqual([]);
    expect(comp.variante?.code).toBe('parfaite');
  });

  it('signale les résultats périmés après modification', () => {
    comp.resultat = RESULTAT;
    comp.marquerPerime();
    expect(comp.resultatPerime).toBeTrue();
  });

  it('remonte l\'erreur du serveur', () => {
    saisir3Points();
    service.generer.and.returnValue(throwError(() => ({ error: { detail: 'Points confondus' } })));
    comp.generer();
    expect(comp.erreur).toBe('Points confondus');
    expect(comp.calcul).toBeFalse();
  });

  it('repère la meilleure valeur de chaque indicateur', () => {
    comp.resultat = RESULTAT;
    const ligneScore = comp.comparaison[0];
    expect(comp.estMeilleure(ligneScore, RESULTAT.parfaite)).toBeTrue();
    expect(comp.estMeilleure(ligneScore, RESULTAT.variantes[0])).toBeFalse();
    const ligneLignes = comp.comparaison.find(l => l.libelle === 'Lignes de base')!;
    expect(comp.estMeilleure(ligneLignes, RESULTAT.variantes[0])).toBeFalse();
  });

  it('reprend la LPA d\'un SDGPS et sa zone proposée', () => {
    service.sourcesLpa.and.returnValue(of([{ ssdgps_id: 's1', piece_id: 'p', libelle: 'L', nature_ssdgps: 'DDC/GPS', nb_points: 1 }]));
    comp.choisirSource('lpa');
    expect(comp.sourcesLpa.length).toBe(1);
    service.sourceLpa.and.returnValue(of({
      ssdgps_id: 's1', libelle: 'SDGPS 1', nature_ssdgps: 'DDC/GPS', zone_proposee: 'sud',
      points: [{ nom_point: 'B1', x_m: 1, y_m: 2 }],
    }));
    comp.ssdgpsChoisi = 's1';
    comp.chargerLpa();
    expect(comp.points.length).toBe(1);
    expect(comp.points[0].statut).toBe('ancien');
    expect(comp.zone).toBe('sud');
    expect(comp.libelleLpa).toBe('SDGPS 1');
  });

  it('ajoute un fond personnel valide, le mémorise et le supprime', () => {
    comp.nouveauFond = { nom: 'Ortho', type: 'xyz', url: 'https://t/{z}/{x}/{y}.png', couches: '', attribution: '' };
    comp.ajouterFond();
    expect(comp.erreurFond).toBe('');
    expect(comp.fondsPersonnels.length).toBe(1);
    expect(comp.fondActif?.nom).toBe('Ortho');
    expect(JSON.parse(localStorage.getItem(CLE_FONDS_PERSONNELS) || '[]').length).toBe(1);
    comp.supprimerFond(comp.fondsPersonnels[0].id);
    expect(comp.fondsPersonnels.length).toBe(0);
    expect(comp.fondActifId).toBe('osm');
  });

  it('refuse un fond invalide', () => {
    comp.nouveauFond = { nom: 'X', type: 'xyz', url: 'https://t/tuile.png', couches: '', attribution: '' };
    comp.ajouterFond();
    expect(comp.erreurFond).toContain('{z}');
    expect(comp.fondsPersonnels.length).toBe(0);
  });
});
