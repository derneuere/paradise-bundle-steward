import { defineProfile } from '../types';
import type { ParsedSnapshotData } from '@/lib/core/snapshotData';
import { snapshotDataResourceSchema } from '@/lib/schema/resources/snapshotData';

export const snapshotDataProfile = defineProfile<ParsedSnapshotData>({
	kind: 'default',
	displayName: 'Snapshot Data',
	schema: snapshotDataResourceSchema,
});
