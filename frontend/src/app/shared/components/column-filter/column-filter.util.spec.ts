import {
  distinctColumnValues, rowMatchesColumnFilters, withColumnFilter, isColumnFiltered,
  activeFilterCount, normalizeSearch, defaultFormat, EMPTY_FACET_LABEL,
  parseNumberValue, parseDateValue, buildDateTree, filterKindLabel,
} from './column-filter.util';

describe('column-filter.util (filtre de colonne façon Excel)', () => {
  const rows = [
    { ville: 'Rabat', actif: true, n: 10 },
    { ville: 'casablanca', actif: false, n: 2 },
    { ville: 'Rabat', actif: true, n: 10 },
    { ville: '', actif: true, n: null },
  ];

  describe('defaultFormat', () => {
    it('convertit les booléens en Oui/Non et les nuls en chaîne vide', () => {
      expect(defaultFormat({ a: true }, 'a')).toBe('Oui');
      expect(defaultFormat({ a: false }, 'a')).toBe('Non');
      expect(defaultFormat({ a: null }, 'a')).toBe('');
      expect(defaultFormat({}, 'a')).toBe('');
      expect(defaultFormat({ a: 12 }, 'a')).toBe('12');
    });
  });

  describe('distinctColumnValues', () => {
    it('regroupe les valeurs identiques et compte les occurrences', () => {
      const facets = distinctColumnValues(rows, 'ville');
      expect(facets.find(f => f.value === 'Rabat')!.count).toBe(2);
      expect(facets.find(f => f.value === 'casablanca')!.count).toBe(1);
    });

    it('trie sans tenir compte de la casse/accents et place les vides en dernier', () => {
      const facets = distinctColumnValues(rows, 'ville');
      expect(facets.map(f => f.value)).toEqual(['casablanca', 'Rabat', '']);
      expect(facets[facets.length - 1].label).toBe(EMPTY_FACET_LABEL);
    });

    it('trie numériquement quand les valeurs sont des nombres', () => {
      const nums = [{ n: 100 }, { n: 9 }, { n: 20 }];
      expect(distinctColumnValues(nums, 'n').map(f => f.value)).toEqual(['9', '20', '100']);
    });

    it('utilise le formateur fourni (valeur AFFICHÉE, comme Excel)', () => {
      const fmt = (r: any) => (r.actif ? 'Actif' : 'Inactif');
      expect(distinctColumnValues(rows, 'actif', fmt).map(f => f.value)).toEqual(['Actif', 'Inactif']);
    });

    it('accepte une liste vide ou nulle', () => {
      expect(distinctColumnValues([], 'x')).toEqual([]);
      expect(distinctColumnValues(null as any, 'x')).toEqual([]);
    });
  });

  describe('rowMatchesColumnFilters', () => {
    it('sans filtre, toutes les lignes passent', () => {
      expect(rows.every(r => rowMatchesColumnFilters(r, {}))).toBeTrue();
    });

    it('OU entre les valeurs d’une même colonne', () => {
      const f = { ville: ['Rabat', 'casablanca'] };
      expect(rows.filter(r => rowMatchesColumnFilters(r, f)).length).toBe(3);
    });

    it('ET entre colonnes', () => {
      const f = { ville: ['Rabat'], n: ['10'] };
      expect(rows.filter(r => rowMatchesColumnFilters(r, f)).length).toBe(2);
      expect(rows.filter(r => rowMatchesColumnFilters(r, { ville: ['Rabat'], n: ['2'] })).length).toBe(0);
    });

    it('filtre correctement les valeurs vides', () => {
      expect(rows.filter(r => rowMatchesColumnFilters(r, { ville: [''] })).length).toBe(1);
    });
  });

  describe('withColumnFilter', () => {
    it('ajoute un filtre sans muter la map source', () => {
      const src = {};
      const next = withColumnFilter(src, 'ville', ['Rabat']);
      expect(next).toEqual({ ville: ['Rabat'] });
      expect(src).toEqual({});
    });

    it('retire le filtre quand les valeurs sont nulles', () => {
      const next = withColumnFilter({ ville: ['Rabat'], n: ['10'] }, 'ville', null);
      expect(next).toEqual({ n: ['10'] });
    });
  });

  it('isColumnFiltered / activeFilterCount', () => {
    const f = { ville: ['Rabat'], n: ['10'] };
    expect(isColumnFiltered(f, 'ville')).toBeTrue();
    expect(isColumnFiltered(f, 'inconnu')).toBeFalse();
    expect(activeFilterCount(f)).toBe(2);
    expect(activeFilterCount({})).toBe(0);
  });

  it('normalizeSearch ignore casse et accents', () => {
    expect(normalizeSearch('Créé LE')).toBe('cree le');
    expect(normalizeSearch('ÀÉÎÔÙ')).toBe('aeiou');
    expect(normalizeSearch('')).toBe('');
  });
});

/**
 * Adaptation au TYPE de données (comme Excel) : le tri et le regroupement des valeurs
 * dépendent du type de la colonne — numérique, chronologique, alphabétique.
 */
describe('column-filter.util (adaptation au type)', () => {
  it('parseNumberValue accepte les formats courants', () => {
    expect(parseNumberValue(42)).toBe(42);
    expect(parseNumberValue('1 234,56')).toBeCloseTo(1234.56, 2);
    expect(parseNumberValue('-7')).toBe(-7);
    expect(parseNumberValue('abc')).toBeNull();
    expect(parseNumberValue(null)).toBeNull();
  });

  it('parseDateValue accepte l’ISO et l’affichage français', () => {
    expect(parseDateValue('2026-07-21T10:00:00Z')!.getFullYear()).toBe(2026);
    const fr = parseDateValue('21/07/2026')!;
    expect(fr.getFullYear()).toBe(2026);
    expect(fr.getMonth()).toBe(6);       // juillet
    expect(fr.getDate()).toBe(21);
    expect(parseDateValue('pas une date')).toBeNull();
    expect(parseDateValue('')).toBeNull();
  });

  describe('tri selon le type', () => {
    it('NOMBRE : tri numérique, pas alphabétique', () => {
      const rows = [{ n: 100 }, { n: 9 }, { n: 20 }, { n: -3 }];
      const values = distinctColumnValues(rows, 'n', undefined, 'number').map(f => f.value);
      expect(values).toEqual(['-3', '9', '20', '100']);
    });

    it('DATE : tri chronologique à partir de la valeur affichée (jj/mm/aaaa)', () => {
      // Trié alphabétiquement, « 01/12/2025 » précèderait « 02/01/2026 » : c'est le bug corrigé.
      const rows = [
        { d: '2026-01-02T00:00:00Z' },
        { d: '2025-12-01T00:00:00Z' },
        { d: '2026-03-15T00:00:00Z' },
      ];
      const fmt = (r: any) => {
        const dt = new Date(r.d);
        return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
      };
      const values = distinctColumnValues(rows, 'd', fmt, 'date').map(f => f.value);
      expect(values).toEqual(['01/12/2025', '02/01/2026', '15/03/2026']);
    });

    it('TEXTE : tri alphabétique insensible à la casse', () => {
      const rows = [{ t: 'béta' }, { t: 'Alpha' }, { t: 'gamma' }];
      expect(distinctColumnValues(rows, 't', undefined, 'text').map(f => f.value))
        .toEqual(['Alpha', 'béta', 'gamma']);
    });

    it('les valeurs vides restent en dernier quel que soit le type', () => {
      const rows = [{ n: 5 }, { n: null }, { n: 1 }];
      const values = distinctColumnValues(rows, 'n', undefined, 'number').map(f => f.value);
      expect(values[values.length - 1]).toBe('');
    });
  });

  describe('buildDateTree', () => {
    const facets = [
      { value: '01/12/2025', label: '01/12/2025', count: 1 },
      { value: '02/01/2026', label: '02/01/2026', count: 2 },
      { value: '15/01/2026', label: '15/01/2026', count: 3 },
      { value: '—', label: '—', count: 4 },
    ];

    it('regroupe en Année ▸ Mois ▸ Jour, dans l’ordre chronologique', () => {
      const { tree } = buildDateTree(facets);
      expect(tree.map(y => y.label)).toEqual(['2025', '2026']);
      const y2026 = tree[1];
      expect(y2026.children.map(m => m.label)).toEqual(['janvier']);
      expect(y2026.children[0].children.map(d => d.label)).toEqual(['02', '15']);
    });

    it('cumule les occurrences à chaque niveau', () => {
      const { tree } = buildDateTree(facets);
      expect(tree[1].count).toBe(5);               // 2 + 3 sur 2026
      expect(tree[1].children[0].count).toBe(5);
      expect(tree[1].children[0].children[0].count).toBe(2);
    });

    it('un nœud porte toutes les valeurs qu’il couvre (case parent)', () => {
      const { tree } = buildDateTree(facets);
      expect(tree[1].values.sort()).toEqual(['02/01/2026', '15/01/2026']);
    });

    it('renvoie à part les valeurs non datées (restent filtrables)', () => {
      const { others } = buildDateTree(facets);
      expect(others.map(f => f.value)).toEqual(['—']);
    });
  });

  it('filterKindLabel reprend le vocabulaire d’Excel', () => {
    expect(filterKindLabel('number')).toBe('Filtres numériques');
    expect(filterKindLabel('date')).toBe('Filtres chronologiques');
    expect(filterKindLabel('boolean')).toBe('Filtres logiques');
    expect(filterKindLabel('text')).toBe('Filtres textuels');
    expect(filterKindLabel(undefined)).toBe('Filtres textuels');
  });
});
