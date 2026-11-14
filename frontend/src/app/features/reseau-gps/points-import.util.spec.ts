import * as XLSX from 'xlsx';
import {
  detecterSeparateur, lignesCsv, lireFichierPoints, lireNombre, lireStatut, normaliserEntete,
  pointsDepuisLignes,
} from './points-import.util';

describe('points-import.util', () => {
  it('normalise les en-têtes sans casse ni accents', () => {
    expect(normaliserEntete('Nom Point')).toBe('nompoint');
    expect(normaliserEntete('Référence')).toBe('reference');
    expect(normaliserEntete('X(m)')).toBe('xm');
    expect(normaliserEntete('Nature Matérialisation')).toBe('naturematerialisation');
  });

  it('lit les nombres français et internationaux', () => {
    expect(lireNombre('420 000,50')).toBe(420000.5);
    expect(lireNombre('420000.5')).toBe(420000.5);
    expect(lireNombre(12)).toBe(12);
    expect(lireNombre('')).toBeNull();
    expect(lireNombre('abc')).toBeNull();
  });

  it('reconnaît le statut', () => {
    expect(lireStatut('Nouveau')).toBe('nouveau');
    expect(lireStatut('N')).toBe('nouveau');
    expect(lireStatut('ancien')).toBe('ancien');
    expect(lireStatut('')).toBe('ancien');
  });

  it('détecte le séparateur CSV', () => {
    expect(detecterSeparateur('a;b;c')).toBe(';');
    expect(detecterSeparateur('a,b,c')).toBe(',');
    expect(detecterSeparateur('a\tb\tc')).toBe('\t');
  });

  it('lit un CSV avec les libellés de la LPA', () => {
    const csv = '﻿ID;Nom Point;X(m);Y(m);Référence;Nature Matérialisation;Nature Signalisation;Statut\n' +
      '1;B1;420000,5;380000;R1;Borne;Peinture;ancien\n' +
      '2;N1;421000;381000;;;;nouveau\n';
    const pts = pointsDepuisLignes(lignesCsv(csv));
    expect(pts.length).toBe(2);
    expect(pts[0]).toEqual(jasmine.objectContaining({
      id: '1', nom_point: 'B1', x_m: 420000.5, y_m: 380000, reference: 'R1',
      nature_materialisation: 'Borne', nature_signalisation: 'Peinture', statut: 'ancien',
    }));
    expect(pts[1].statut).toBe('nouveau');
  });

  it('applique l\'ordre de la LPA sans en-tête et ignore les lignes sans coordonnées', () => {
    const pts = pointsDepuisLignes([['1', 'A', '100', '200', 'R'], ['', 'Total', '', '']]);
    expect(pts.length).toBe(1);
    expect(pts[0]).toEqual(jasmine.objectContaining({ nom_point: 'A', x_m: 100, y_m: 200, reference: 'R' }));
  });

  it('lit un classeur Excel', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['nom_point', 'x_m', 'y_m'], ['A', 1, 2], ['B', 3, 4]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LPA');
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const pts = await lireFichierPoints(new File([data], 'lpa.xlsx'));
    expect(pts.map(p => p.nom_point)).toEqual(['A', 'B']);
    expect(pts[1].y_m).toBe(4);
  });

  it('lit un fichier CSV', async () => {
    const pts = await lireFichierPoints(new File(['nom,x,y\nA,1,2\n'], 'pts.csv'));
    expect(pts.length).toBe(1);
  });
});
