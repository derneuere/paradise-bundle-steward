// TrafficDataOverlay — selection round-trip test for nested-path AND
// PVS-cell shapes. PVS cells are interesting because they live at the
// resource root (`['pvs', 'hullPvsSets', N]`) — they're not owned by a
// hull, so they need their own variant in the selection union.
//
// We don't mount through react-dom — the repo has no DOM-test infra. The
// overlay's render shape is a thin orchestration layer over the helpers
// exercised here; covering them gives the same effective coverage at a
// fraction of the dep cost.

import { describe, it, expect } from 'vitest';
import {
	trafficActiveTabFromSelection,
	trafficPathSelection,
	trafficSelectionCodec,
	trafficSelectionPath,
} from './TrafficDataOverlay';
import type { NodePath } from '@/lib/schema/walk';

describe('TrafficDataOverlay', () => {
	it('round-trips nested per-hull paths through path↔selection', () => {
		// Hull only
		expect(trafficPathSelection(['hulls', 5])).toEqual({ hullIndex: 5 });
		expect(trafficSelectionPath({ hullIndex: 5 })).toEqual(['hulls', 5]);

		// All five sub-types — the gnarly part of the legacy translation.
		const subPairs: Array<{
			path: NodePath;
			sel: { hullIndex: number; sub: { type: string; index: number } };
		}> = [
			{ path: ['hulls', 3, 'sections', 12],              sel: { hullIndex: 3, sub: { type: 'section',       index: 12 } } },
			{ path: ['hulls', 3, 'rungs', 7],                  sel: { hullIndex: 3, sub: { type: 'rung',          index: 7 } } },
			{ path: ['hulls', 3, 'junctions', 1],              sel: { hullIndex: 3, sub: { type: 'junction',      index: 1 } } },
			{ path: ['hulls', 3, 'lightTriggers', 4],          sel: { hullIndex: 3, sub: { type: 'lightTrigger',  index: 4 } } },
			{ path: ['hulls', 3, 'staticTrafficVehicles', 9],  sel: { hullIndex: 3, sub: { type: 'staticVehicle', index: 9 } } },
		];
		for (const { path, sel } of subPairs) {
			expect(trafficPathSelection(path)).toEqual(sel);
			expect(trafficSelectionPath(sel as never)).toEqual(path);
		}
	});

	it('round-trips PVS-cell selections (top-level, not owned by a hull)', () => {
		expect(trafficPathSelection(['pvs', 'hullPvsSets', 42])).toEqual({
			kind: 'pvsCell',
			cellIndex: 42,
		});
		expect(trafficSelectionPath({ kind: 'pvsCell', cellIndex: 42 })).toEqual([
			'pvs', 'hullPvsSets', 42,
		]);
	});

	it('collapses sub-paths inside a list item to the parent marker', () => {
		// Drilling into a section's mfSpeed should still highlight the section.
		expect(trafficPathSelection(['hulls', 0, 'sections', 7, 'mfSpeed']))
			.toEqual({ hullIndex: 0, sub: { type: 'section', index: 7 } });
		// An unknown list under hull collapses to hull-only selection.
		expect(trafficPathSelection(['hulls', 0, 'unknownList', 0]))
			.toEqual({ hullIndex: 0 });
	});

	it('returns null for paths outside the TrafficData resource', () => {
		expect(trafficPathSelection([])).toBeNull();
		expect(trafficPathSelection(['somethingElse', 0])).toBeNull();
		expect(trafficPathSelection(['hulls'])).toBeNull();
		expect(trafficPathSelection(['hulls', 'notANumber'] as unknown as NodePath)).toBeNull();
		expect(trafficSelectionPath(null)).toEqual([]);
	});

	it('exposes the new Selection-module codec with the unified `{kind, indices}` shape', () => {
		expect(trafficSelectionCodec.pathToSelection(['hulls', 5]))
			.toEqual({ kind: 'hull', indices: [5] });
		expect(trafficSelectionCodec.pathToSelection(['hulls', 3, 'sections', 12]))
			.toEqual({ kind: 'section', indices: [3, 12] });
		expect(trafficSelectionCodec.pathToSelection(['hulls', 3, 'rungs', 7]))
			.toEqual({ kind: 'rung', indices: [3, 7] });
		expect(trafficSelectionCodec.pathToSelection(['hulls', 3, 'junctions', 1]))
			.toEqual({ kind: 'junction', indices: [3, 1] });
		expect(trafficSelectionCodec.pathToSelection(['hulls', 3, 'lightTriggers', 4]))
			.toEqual({ kind: 'lightTrigger', indices: [3, 4] });
		expect(trafficSelectionCodec.pathToSelection(['hulls', 3, 'staticTrafficVehicles', 9]))
			.toEqual({ kind: 'staticVehicle', indices: [3, 9] });
		expect(trafficSelectionCodec.pathToSelection(['pvs', 'hullPvsSets', 42]))
			.toEqual({ kind: 'pvsCell', indices: [42] });

		// Inverse — every kind round-trips.
		expect(trafficSelectionCodec.selectionToPath({ kind: 'hull', indices: [5] }))
			.toEqual(['hulls', 5]);
		expect(trafficSelectionCodec.selectionToPath({ kind: 'section', indices: [3, 12] }))
			.toEqual(['hulls', 3, 'sections', 12]);
		expect(trafficSelectionCodec.selectionToPath({ kind: 'rung', indices: [3, 7] }))
			.toEqual(['hulls', 3, 'rungs', 7]);
		expect(trafficSelectionCodec.selectionToPath({ kind: 'staticVehicle', indices: [3, 9] }))
			.toEqual(['hulls', 3, 'staticTrafficVehicles', 9]);
		expect(trafficSelectionCodec.selectionToPath({ kind: 'pvsCell', indices: [42] }))
			.toEqual(['pvs', 'hullPvsSets', 42]);

		expect(trafficSelectionCodec.pathToSelection([])).toBeNull();
	});

	it('derives activeTab from the sub-type — drives 3D layer highlight filtering', () => {
		expect(trafficActiveTabFromSelection(null)).toBe('sections');
		expect(trafficActiveTabFromSelection({ hullIndex: 0 })).toBe('sections');
		expect(trafficActiveTabFromSelection({ kind: 'pvsCell', cellIndex: 0 })).toBe('sections');
		expect(trafficActiveTabFromSelection({ hullIndex: 0, sub: { type: 'section',       index: 0 } })).toBe('sections');
		expect(trafficActiveTabFromSelection({ hullIndex: 0, sub: { type: 'rung',          index: 0 } })).toBe('rungs');
		expect(trafficActiveTabFromSelection({ hullIndex: 0, sub: { type: 'junction',      index: 0 } })).toBe('junctions');
		expect(trafficActiveTabFromSelection({ hullIndex: 0, sub: { type: 'lightTrigger',  index: 0 } })).toBe('lightTriggers');
		expect(trafficActiveTabFromSelection({ hullIndex: 0, sub: { type: 'staticVehicle', index: 0 } })).toBe('staticVehicles');
	});
});
