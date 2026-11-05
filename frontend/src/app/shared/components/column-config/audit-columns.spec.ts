import {
  auditColumns, withAuditColumns, isAuditColumn,
  AUDIT_COLUMN_LABELS, AUDIT_COLUMN_ORDER, AUDIT_COLUMN_DESCRIPTIONS,
} from './audit-columns';

/**
 * Colonnes d'audit standard : garantit l'HOMOGÉNÉITÉ des libellés dans toute l'app
 * (cf. CLAUDE.md « Colonnes d'audit obligatoires »).
 */
describe('audit-columns (colonnes d’audit standard)', () => {
  it('expose les 7 colonnes attendues, dans l’ordre standard', () => {
    expect(AUDIT_COLUMN_ORDER).toEqual([
      'created_by_email', 'created_at',
      'updated_by_email', 'updated_at',
      'is_deleted', 'deleted_by_email', 'deleted_at',
    ]);
    expect(auditColumns().length).toBe(7);
  });

  it('utilise les libellés unifiés', () => {
    expect(AUDIT_COLUMN_LABELS['created_by_email']).toBe('Créé par');
    expect(AUDIT_COLUMN_LABELS['created_at']).toBe('Créé le');
    expect(AUDIT_COLUMN_LABELS['updated_by_email']).toBe('Modifié par');
    expect(AUDIT_COLUMN_LABELS['updated_at']).toBe('Modifié le');
    expect(AUDIT_COLUMN_LABELS['is_deleted']).toBe('Supprimé');
    expect(AUDIT_COLUMN_LABELS['deleted_by_email']).toBe('Supprimé par');
    expect(AUDIT_COLUMN_LABELS['deleted_at']).toBe('Supprimé le');
  });

  it('chaque colonne a un type cohérent, une description et est masquée par défaut', () => {
    for (const col of auditColumns()) {
      expect(col.visible).withContext(col.field).toBeFalse();
      expect(col.description).withContext(col.field).toBe(AUDIT_COLUMN_DESCRIPTIONS[col.field]);
      const expected = col.field === 'is_deleted' ? 'boolean' : (col.field.endsWith('_at') ? 'date' : 'text');
      expect(col.type).withContext(col.field).toBe(expected as any);
    }
  });

  it('isAuditColumn distingue les colonnes d’audit des colonnes métier', () => {
    expect(isAuditColumn('created_at')).toBeTrue();
    expect(isAuditColumn('deleted_by_email')).toBeTrue();
    expect(isAuditColumn('nom_projet')).toBeFalse();
    // `modified_by_email` est l'ancien nom (organisations) : ce n'est PAS le nom unifié.
    expect(isAuditColumn('modified_by_email')).toBeFalse();
  });

  describe('withAuditColumns', () => {
    it('ajoute les colonnes d’audit manquantes en fin de catalogue', () => {
      const out = withAuditColumns([{ field: 'nom', label: 'Nom', visible: true }]);
      expect(out.map(c => c.field)).toEqual(['nom', ...AUDIT_COLUMN_ORDER]);
    });

    it('normalise les libellés divergents déjà présents, sans toucher au métier', () => {
      const out = withAuditColumns([
        { field: 'nom', label: 'Nom', visible: true },
        { field: 'created_at', label: 'Date Création', visible: true },
        { field: 'updated_at', label: 'Dernière modification', visible: false },
      ]);
      expect(out.find(c => c.field === 'created_at')!.label).toBe('Créé le');
      expect(out.find(c => c.field === 'updated_at')!.label).toBe('Modifié le');
      expect(out.find(c => c.field === 'nom')!.label).toBe('Nom');
    });

    it('préserve l’ordre métier et la visibilité déjà choisie pour les colonnes d’audit', () => {
      const out = withAuditColumns([
        { field: 'created_at', label: 'Date Création', visible: true },
        { field: 'nom', label: 'Nom', visible: true },
      ]);
      expect(out.map(c => c.field).slice(0, 2)).toEqual(['created_at', 'nom']);
      expect(out.find(c => c.field === 'created_at')!.visible).toBeTrue();
    });

    it('ne mute pas le catalogue source', () => {
      const source = [{ field: 'created_at', label: 'Date Création', visible: true }];
      withAuditColumns(source);
      expect(source[0].label).toBe('Date Création');
      expect(source.length).toBe(1);
    });
  });
});
