// Discriminated-union shapes the V12 overlay uses to describe a gizmo
// gesture. A gesture is one (target, delta) pair: the target tells the
// dispatcher which no-cascade op to run; the delta is the staged
// translate / rotate the gizmo is currently emitting.
//
// `bulk` carries the flattened `AISectionEntityRef[]` and the Pivot
// captured at gesture start (snapshot prevents drift mid-rotate). Per
// ADR-0009 none of these cascade by default — `delta.cascade` opts in
// for section / bulk (sub-entity cascade is not wired in this slice).

import type { AISectionEntityRef } from '@/lib/core/aiSectionsOps';
import type { BulkTransformDelta } from '@/hooks/useBulkTransformDrag';

export type DragTarget =
	| { kind: 'section'; sectionIdx: number }
	| {
			kind: 'bulk';
			entities: readonly AISectionEntityRef[];
			pivot: { x: number; y: number; z: number };
		}
	| { kind: 'corner'; sectionIdx: number; cornerIdx: number }
	| { kind: 'portalAnchor'; sectionIdx: number; portalIdx: number }
	| { kind: 'boundaryLineEndpoint'; sectionIdx: number; portalIdx: number; lineIdx: number; endIdx: number }
	| { kind: 'noGoLineEndpoint'; sectionIdx: number; lineIdx: number; endIdx: number };

export type ActiveDrag = {
	target: DragTarget;
	delta: BulkTransformDelta;
};
