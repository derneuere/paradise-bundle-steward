import { defineProfile } from '../types';
import type { ParsedPropGraphicsList } from '@/lib/core/propGraphicsList';
import { propGraphicsListResourceSchema } from '@/lib/schema/resources/propGraphicsList';

// Single-version data catalogue (no 3D overlay) — the schema alone drives the
// inspector, so no render binding is registered in bindings.ts.
export const propGraphicsListProfile = defineProfile<ParsedPropGraphicsList>({
	kind: 'default',
	displayName: 'Prop Graphics List',
	schema: propGraphicsListResourceSchema,
});
