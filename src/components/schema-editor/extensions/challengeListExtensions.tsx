// Extensions that wrap the pre-schema ChallengeList components so the
// migration preserves the old tab UX without a rewrite.
//
// Three extensions are registered:
//   - ChallengeOverviewTab   — wraps <ChallengeOverview> on the root
//                              propertyGroup.
//   - ChallengeAction1Tab    — wraps <ActionEditor> for actions[0] on
//                              ChallengeListEntry.
//   - ChallengeAction2Tab    — wraps <ActionEditor> for actions[1], with
//                              the numActions < 2 "disabled" state the
//                              existing editor shows.
//
// Path contracts:
//   - ChallengeOverviewTab  path: []                 value: ParsedChallengeList
//   - ChallengeAction1Tab   path: ['challenges', i]  value: ChallengeListEntry
//   - ChallengeAction2Tab   path: ['challenges', i]  value: ChallengeListEntry
//
// Extensions mutate through `setValue(next)` (scoped to the extension's
// path) which the inspector translates into an immutable update on the
// root — structural sharing keeps siblings untouched.

import React, { useMemo } from 'react';
import type { SchemaExtensionProps, ExtensionRegistry } from '../context';
import type {
	ChallengeListEntry,
	ChallengeListEntryAction,
	ParsedChallengeList,
} from '@/lib/core/challengeList';
import { ChallengeOverview } from '@/components/challangelist/ChallengeOverview';
import { ActionEditor } from '@/components/challangelist/ActionEditor';

// ---------------------------------------------------------------------------
// Stats computation — lifted from the old ChallengeListEditor so the
// overview tab keeps its counts.
// ---------------------------------------------------------------------------

type OverviewStats = {
	difficultyCount: { easy: number; medium: number; hard: number; veryHard: number };
	playerCount: {
		two: number;
		three: number;
		four: number;
		five: number;
		six: number;
		seven: number;
		eight: number;
		other: number;
	};
	entitlementCount: Map<number, number>;
};

function computeStats(data: ParsedChallengeList): OverviewStats {
	const difficultyCount = { easy: 0, medium: 0, hard: 0, veryHard: 0 };
	const playerCount = {
		two: 0,
		three: 0,
		four: 0,
		five: 0,
		six: 0,
		seven: 0,
		eight: 0,
		other: 0,
	};
	const entitlementCount = new Map<number, number>();

	for (const challenge of data.challenges) {
		switch (challenge.difficulty) {
			case 0:
				difficultyCount.easy++;
				break;
			case 1:
				difficultyCount.medium++;
				break;
			case 2:
				difficultyCount.hard++;
				break;
			case 3:
				difficultyCount.veryHard++;
				break;
		}

		switch (challenge.numPlayers) {
			case 0x22:
				playerCount.two++;
				break;
			case 0x33:
				playerCount.three++;
				break;
			case 0x44:
				playerCount.four++;
				break;
			case 0x55:
				playerCount.five++;
				break;
			case 0x66:
				playerCount.six++;
				break;
			case 0x77:
				playerCount.seven++;
				break;
			case 0x88:
				playerCount.eight++;
				break;
			default:
				playerCount.other++;
				break;
		}

		const prev = entitlementCount.get(challenge.entitlementGroup) ?? 0;
		entitlementCount.set(challenge.entitlementGroup, prev + 1);
	}

	return { difficultyCount, playerCount, entitlementCount };
}

// ---------------------------------------------------------------------------
// Root-level extension — overview statistics
// ---------------------------------------------------------------------------

export const ChallengeOverviewExtension: React.FC<SchemaExtensionProps> = ({ data }) => {
	const typed = data as ParsedChallengeList;
	const stats = useMemo(() => computeStats(typed), [typed]);
	return <ChallengeOverview data={typed} stats={stats} />;
};

// ---------------------------------------------------------------------------
// Per-challenge extensions — Action 1 / Action 2 editor tabs
// ---------------------------------------------------------------------------

type ActionExtensionFactoryOptions = {
	actionIndex: 0 | 1;
};

function makeActionExtension(
	{ actionIndex }: ActionExtensionFactoryOptions,
): React.FC<SchemaExtensionProps> {
	const Component: React.FC<SchemaExtensionProps> = ({ value, setValue }) => {
		const challenge = value as ChallengeListEntry | undefined;
		if (!challenge || !Array.isArray(challenge.actions)) {
			return (
				<div className="text-sm text-muted-foreground">
					No challenge selected.
				</div>
			);
		}
		const action = challenge.actions[actionIndex];
		if (!action) {
			return (
				<div className="text-sm text-muted-foreground">
					Action {actionIndex + 1} missing from this challenge.
				</div>
			);
		}
		const handleChange = (updated: ChallengeListEntryAction) => {
			const nextActions = challenge.actions.slice();
			nextActions[actionIndex] = updated;
			setValue({ ...challenge, actions: nextActions });
		};
		return (
			<ActionEditor
				action={action}
				onChange={handleChange}
				actionIndex={actionIndex + 1}
				disabled={actionIndex === 1 && challenge.numActions < 2}
			/>
		);
	};
	Component.displayName = `ChallengeAction${actionIndex + 1}Extension`;
	return Component;
}

export const ChallengeAction1Extension = makeActionExtension({ actionIndex: 0 });
export const ChallengeAction2Extension = makeActionExtension({ actionIndex: 1 });

// ---------------------------------------------------------------------------
// Registry bundle — hand this map to SchemaEditorProvider.
// ---------------------------------------------------------------------------

export const challengeListExtensions: ExtensionRegistry = {
	ChallengeOverviewTab: ChallengeOverviewExtension,
	ChallengeAction1Tab: ChallengeAction1Extension,
	ChallengeAction2Tab: ChallengeAction2Extension,
};
