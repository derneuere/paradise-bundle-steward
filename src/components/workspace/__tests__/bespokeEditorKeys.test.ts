import { describe, it, expect } from 'vitest';
import { hasBespokeEditor, BESPOKE_EDITOR_KEYS } from '../bespokeEditorKeys';

// The Workspace edits most resources through the generic schema-driven
// inspector; a couple have no schema and ship a hand-written editor instead.
// This spec pins which keys take the bespoke path so a future agent can see
// the migration boundary at a glance.
describe('hasBespokeEditor', () => {
	it('recognises the schema-less resources', () => {
		expect(hasBespokeEditor('deformationSpec')).toBe(true);
		expect(hasBespokeEditor('attribSysVault')).toBe(true);
	});

	it('rejects schema-driven, unknown, and empty keys', () => {
		expect(hasBespokeEditor('texture')).toBe(false);
		expect(hasBespokeEditor('polygonSoupList')).toBe(false);
		expect(hasBespokeEditor('aiSections')).toBe(false);
		expect(hasBespokeEditor('')).toBe(false);
		expect(hasBespokeEditor(undefined)).toBe(false);
	});

	it('exposes a stable key list', () => {
		expect([...BESPOKE_EDITOR_KEYS]).toEqual(['deformationSpec', 'attribSysVault']);
	});
});
