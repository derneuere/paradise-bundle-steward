// Cross-resource auto-disable integration tests (issue #79).
//
// Verifies the ADR-0011 invariant for the four resource families wired in
// by this slice: zone-list points, traffic yaw-packed boxes, traffic lane
// rungs, and street-data reference positions. Any Selection containing any
// XZ-packed contributor (zone, traffic yaw box, lane rung) must AND down
// the rotate.x and rotate.z rings via `intersectTransformAxes`. A
// pure-3D contributor (street ref) on its own leaves all rings enabled,
// but mixing it with an XZ-packed sibling still grays out pitch/roll.

import { describe, it, expect } from 'vitest';
import {
	bulkAISectionsAxes,
	type AISectionEntityRef,
} from '../aiSectionsOps';
import {
	bulkStreetDataAxes,
	type StreetDataEntityRef,
} from '../streetDataOps';
import {
	bulkTrafficDataAxes,
	type TrafficDataEntityRef,
} from '../trafficDataOps';
import {
	bulkZoneListAxes,
	type ZoneListEntityRef,
} from '../zoneListOps';
import {
	intersectTransformAxes,
	TRANSFORM_AXES_FULL_3D,
} from '../transformAxes';

describe('auto-disable rule — XZ-packed contributor in Selection forces yaw-only', () => {
	it('zone point alone: yaw-only', () => {
		const refs: ZoneListEntityRef[] = [{ kind: 'zone', zoneIdx: 0 }];
		const axes = bulkZoneListAxes(refs);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('traffic yaw box alone: yaw-only', () => {
		const refs: TrafficDataEntityRef[] = [
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
		];
		const axes = bulkTrafficDataAxes(refs);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('traffic lane rung alone: yaw-only', () => {
		const refs: TrafficDataEntityRef[] = [
			{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 },
		];
		const axes = bulkTrafficDataAxes(refs);
		expect(axes?.rotate.x).toBe(false);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(false);
	});

	it('street ref alone: full 3-axis rotate (pure 3D, no veto)', () => {
		const refs: StreetDataEntityRef[] = [{ kind: 'road', roadIdx: 0 }];
		const axes = bulkStreetDataAxes(refs);
		expect(axes?.rotate.x).toBe(true);
		expect(axes?.rotate.y).toBe(true);
		expect(axes?.rotate.z).toBe(true);
	});

	it('mixed: street ref + zone point → yaw-only (zone vetoes pitch/roll)', () => {
		const streetAxes = bulkStreetDataAxes([{ kind: 'road', roadIdx: 0 }]);
		const zoneAxes = bulkZoneListAxes([{ kind: 'zone', zoneIdx: 0 }]);
		expect(streetAxes).not.toBeNull();
		expect(zoneAxes).not.toBeNull();
		const intersected = intersectTransformAxes([streetAxes!, zoneAxes!]);
		expect(intersected.rotate.x).toBe(false);
		expect(intersected.rotate.y).toBe(true);
		expect(intersected.rotate.z).toBe(false);
	});

	it('mixed: trigger box (full 3D placeholder) + zone point → yaw-only', () => {
		// Until trigger boxes (issue #77) land we use TRANSFORM_AXES_FULL_3D
		// as the trigger-box stand-in. Once #77 merges this test stands as
		// the auto-disable regression for the cross-resource case.
		const zoneAxes = bulkZoneListAxes([{ kind: 'zone', zoneIdx: 0 }]);
		const intersected = intersectTransformAxes([TRANSFORM_AXES_FULL_3D, zoneAxes!]);
		expect(intersected.rotate.x).toBe(false);
		expect(intersected.rotate.y).toBe(true);
		expect(intersected.rotate.z).toBe(false);
	});

	it('mixed: traffic yaw box + zone point + AI section + lane rung → yaw-only', () => {
		const aiRefs: AISectionEntityRef[] = [{ kind: 'section', sectionIdx: 0 }];
		const zoneRefs: ZoneListEntityRef[] = [{ kind: 'zone', zoneIdx: 0 }];
		const trafficRefs: TrafficDataEntityRef[] = [
			{ kind: 'junction', hullIdx: 0, junctionIdx: 0 },
			{ kind: 'laneRung', hullIdx: 0, rungIdx: 0 },
		];
		const aiAxes = bulkAISectionsAxes(aiRefs)!;
		const zoneAxes = bulkZoneListAxes(zoneRefs)!;
		const trafficAxes = bulkTrafficDataAxes(trafficRefs)!;
		const intersected = intersectTransformAxes([aiAxes, zoneAxes, trafficAxes]);
		expect(intersected.rotate.x).toBe(false);
		expect(intersected.rotate.y).toBe(true);
		expect(intersected.rotate.z).toBe(false);
		// Translate stays 3-axis (all members allow it).
		expect(intersected.translate.x).toBe(true);
		expect(intersected.translate.y).toBe(true);
		expect(intersected.translate.z).toBe(true);
	});
});
