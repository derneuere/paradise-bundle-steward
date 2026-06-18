// AttribSys Vault profile. Schema-driven inspector; the per-attribute typed
// `fields` are rendered by the `attribSysFields` custom extension (see
// attribSysVaultExtensions). No 3D overlay.

import { defineProfile } from '../types';
import { attribSysVaultResourceSchema } from '@/lib/schema/resources/attribSysVault';

export const attribSysVaultProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'AttribSys Vault',
	schema: attribSysVaultResourceSchema,
});
