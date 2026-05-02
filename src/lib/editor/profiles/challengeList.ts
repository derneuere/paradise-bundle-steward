import { defineProfile } from '../types';
import { challengeListResourceSchema } from '@/lib/schema/resources/challengeList';

export const challengeListProfile = defineProfile<unknown>({
	kind: 'default',
	displayName: 'ChallengeList',
	schema: challengeListResourceSchema,
});
