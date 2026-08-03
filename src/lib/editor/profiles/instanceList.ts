import { defineProfile } from '../types';
import type { ParsedInstanceList } from '@/lib/core/instanceList';
import { instanceListResourceSchema } from '@/lib/schema/resources/instanceList';

// Single-version track-unit model placement list. The schema alone drives the
// inspector; the world-space rendering of these instances is the track
// geometry decode path (`trackGeometryDecode.ts`), not a per-resource overlay,
// so no render binding is registered in bindings.ts.
export const instanceListProfile = defineProfile<ParsedInstanceList>({
	kind: 'default',
	displayName: 'Instance List',
	schema: instanceListResourceSchema,
});
