import { describe, it, expect } from 'vitest';
import { pickProfile, pickProfileByKey } from '../registry';
import { shaderResourceSchema } from '@/lib/schema/resources/shader';

// Minimal ParsedShader-shaped model (only the fields the profile resolver +
// schema root touch).
const shaderModel = {
	name: 'Vehicle_Opaque_Test',
	hasInlineHLSL: false,
	flags: 3,
	numTechniques: 1,
	numConstants: 0,
	numConstantsWithInstanceData: 0,
	techniques: [],
	constants: [],
	hlslSource: '',
	totalSize: 0,
	raw: [],
};

describe('shader editor profile (workspace migration)', () => {
	it('resolves the shader profile by typeId 0x32 and by key', () => {
		const byId = pickProfile(0x32, shaderModel);
		const byKey = pickProfileByKey('shader', shaderModel);
		expect(byId).toBeDefined();
		expect(byKey).toBeDefined();
		expect(byKey).toBe(byId);
		expect(byKey?.schema.key).toBe('shader');
	});

	it('uses the ParsedShader root schema (matches the single-resource data the workspace passes)', () => {
		expect(shaderResourceSchema.rootType).toBe('ParsedShader');
		expect(shaderResourceSchema.registry.ParsedShader).toBeDefined();
		// Techniques + constants are the navigable depth the inspector tree shows.
		const root = shaderResourceSchema.registry.ParsedShader;
		expect(root.fields.techniques.kind).toBe('list');
		expect(root.fields.constants.kind).toBe('list');
	});
});
