import { defineProfile } from '../types';
import type { ParsedCommsToolListDefinition } from '@/lib/core/commsToolListDefinition';
import { commsToolListDefinitionResourceSchema } from '@/lib/schema/resources/commsToolListDefinition';

export const commsToolListDefinitionProfile = defineProfile<ParsedCommsToolListDefinition>({
	kind: 'default',
	displayName: 'Comms Tool List Definition',
	schema: commsToolListDefinitionResourceSchema,
});
