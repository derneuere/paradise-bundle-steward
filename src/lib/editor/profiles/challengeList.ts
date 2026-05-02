import { defineProfile } from '../types';
import { challengeListResourceSchema } from '@/lib/schema/resources/challengeList';
import { challengeListExtensions } from '@/components/schema-editor/extensions/challengeListExtensions';

export const challengeListProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'ChallengeList',
	schema: challengeListResourceSchema,
	extensions: challengeListExtensions,
});
