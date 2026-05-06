// Spec test for the schema-editor extension contract.
//
// These tests are about the registry shape and the narrow-vs-whole-resource
// type distinction — not the rendered output (vitest runs in a node env
// without jsdom in this repo). Each registry below is the exact map every
// production page passes to <SchemaEditorProvider extensions={...}>; the
// goal here is a lightweight regression net: if someone renames a key or
// drops an extension by accident, the per-resource expectation list catches
// it before the schema page silently shows "Extension not registered".
//
// Why the leaflet stub: the triggerDataExtensions registry imports
// RegionsMap, which pulls in leaflet, which touches `window` at module
// load time. The repo's vitest env is `node`, so we shim those before
// the registries are imported.

import { describe, it, expect, vi } from 'vitest';

// Stub leaflet + react-leaflet so triggerDataExtensions' RegionsMap import
// doesn't blow up at module-load time in a node env.
vi.mock('leaflet', () => ({ default: {}, Icon: class {}, latLngBounds: () => ({}) }));
vi.mock('react-leaflet', () => ({
	MapContainer: () => null,
	TileLayer: () => null,
	Rectangle: () => null,
	useMap: () => ({}),
	Marker: () => null,
	Popup: () => null,
}));

// Imports below must happen after the vi.mock calls; vitest hoists them
// automatically but we still keep the order tidy for readability.
import { aiSectionsExtensions } from '../aiSectionsExtensions';
import { challengeListExtensions } from '../challengeListExtensions';
import { polygonSoupListExtensions } from '../collisionTagExtension';
import { renderableExtensions } from '../renderableExtensions';
import { streetDataExtensions } from '../streetDataExtensions';
import { trafficDataExtensions } from '../trafficDataExtensions';
import { triggerDataExtensions } from '../triggerDataExtensions';
import { vehicleListExtensions } from '../vehicleListExtensions';
import type {
	SchemaExtensionProps,
	WholeResourceExtensionProps,
} from '../../context';

describe('schema-editor extension registries', () => {
	const registries = {
		aiSections: aiSectionsExtensions,
		challengeList: challengeListExtensions,
		polygonSoupList: polygonSoupListExtensions,
		renderable: renderableExtensions,
		streetData: streetDataExtensions,
		trafficData: trafficDataExtensions,
		triggerData: triggerDataExtensions,
		vehicleList: vehicleListExtensions,
	};

	// Minimum keys each page needs the registry to expose. If a key is
	// missing the schema's `customRenderer` / `propertyGroup.component`
	// fall-through path renders a yellow warning — see CustomField.tsx —
	// which would silently regress the UI. This test makes the link
	// explicit.
	const expectedKeysByResource: Record<keyof typeof registries, string[]> = {
		aiSections: [
			'AISectionsOverview',
			'AISectionsList',
			'AISectionsResetPairs',
			'AISectionEdges',
		],
		challengeList: [
			'ChallengeOverviewTab',
			'ChallengeAction1Tab',
			'ChallengeAction2Tab',
		],
		polygonSoupList: ['collisionTag'],
		renderable: ['RenderableCard', 'RenderableMeshCard'],
		streetData: [
			'StreetDataOverviewTab',
			'StreetsTab',
			'JunctionsTab',
			'RoadsTab',
			'ChallengesTab',
		],
		trafficData: [
			'SectionsTab',
			'LaneRungsTab',
			'FlowTypesTab',
			'PaintColoursTab',
			'OverviewTab',
			'KillZonesTab',
			'VehiclesTab',
			'TrafficLightsTab',
		],
		triggerData: [
			'HeaderTab',
			'RegionsMapTab',
			'LandmarksTab',
			'GenericRegionsTab',
			'BlackspotsTab',
			'VfxTab',
			'SignatureStuntsTab',
			'KillzonesTab',
			'RoamingTab',
			'SpawnsTab',
		],
		vehicleList: ['VehicleEditorTab'],
	};

	for (const [resourceKey, registry] of Object.entries(registries) as [
		keyof typeof registries,
		(typeof registries)[keyof typeof registries],
	][]) {
		const expected = expectedKeysByResource[resourceKey];
		it(`${resourceKey}: registers exactly the expected keys`, () => {
			expect(Object.keys(registry).sort()).toEqual([...expected].sort());
		});

		it(`${resourceKey}: every entry is a function-typed component`, () => {
			for (const [key, component] of Object.entries(registry)) {
				expect(typeof component, `${resourceKey}.${key}`).toBe('function');
			}
		});
	}

	// Total count surfaces in the PR review summary. If a future change
	// adds or removes an extension, this number changes and the diff is
	// obvious. Not a load-bearing assertion — drop / bump as needed.
	it('total registered extension count is 34', () => {
		const total = Object.values(registries).reduce(
			(acc, reg) => acc + Object.keys(reg).length,
			0,
		);
		expect(total).toBe(34);
	});
});

describe('SchemaExtensionProps / WholeResourceExtensionProps relationship', () => {
	// These are compile-time spec checks. The body is a pure type assertion;
	// at runtime the test just verifies the values pass through. The point
	// is that someone refactoring the types has to keep these compiling.
	it('WholeResourceExtensionProps satisfies SchemaExtensionProps (subtype)', () => {
		const wide: WholeResourceExtensionProps<number> = {
			path: ['x', 1],
			value: 42,
			setValue: () => {},
			selectChild: () => {},
			data: null,
			setData: () => {},
			resource: { rootType: 'X', registry: {} } as never,
		};
		// If WholeResourceExtensionProps<T> is a structural superset of
		// SchemaExtensionProps<T>, this assignment compiles. If someone
		// drops a narrow field from the wide variant, this line will fail
		// to type-check.
		const narrow: SchemaExtensionProps<number> = wide;
		expect(narrow.value).toBe(42);
	});

	it('SchemaExtensionProps default value type is unknown', () => {
		// Default generic should be `unknown` — preserves type safety
		// while letting extensions that don't care about value still
		// type-check without specifying the parameter.
		const narrow: SchemaExtensionProps = {
			path: [],
			value: 'anything',
			setValue: () => {},
			selectChild: () => {},
		};
		expect(narrow.value).toBe('anything');
	});
});
