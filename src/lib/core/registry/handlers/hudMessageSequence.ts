// HudMessageSequence registry handler — thin wrapper around
// parseHudMessageSequence / writeHudMessageSequence in
// src/lib/core/hudMessageSequences.ts.
//
// The one retail bundle (HUDMESSAGESEQUENCES.HMSC) carries SIX sequences,
// so the handler ships a picker config. Every retail sequence is a Dirty
// Tricks arming flow: DTARMING followed by the per-trick award/failure
// message — the picker's secondary text surfaces that chain.

import {
	parseHudMessageSequence,
	writeHudMessageSequence,
	SEQUENCE_MESSAGE_SLOTS,
	DEFAULT_MESSAGE_LENGTH_SECONDS,
	type ParsedHudMessageSequence,
} from '../../hudMessageSequences';
import { decodeCgsId, encodeCgsId } from '../../cgsid';
import type { ResourceHandler, PickerEntry } from '../handler';

function compareByName(a: PickerEntry<ParsedHudMessageSequence>, b: PickerEntry<ParsedHudMessageSequence>): number {
	return a.ctx.name.localeCompare(b.ctx.name, undefined, { numeric: true });
}

function messageChain(model: ParsedHudMessageSequence): string {
	return model.messages.map((m) => decodeCgsId(m.mMessageId) || '∅').join(' → ');
}

export const hudMessageSequenceHandler: ResourceHandler<ParsedHudMessageSequence> = {
	typeId: 0x2e,
	key: 'hudMessageSequence',
	name: 'HUD Message Sequence',
	description: 'Ordered set of HUD message IDs displayed in sequence, each with its own duration — a dev-era feature whose six retail resources are all online Dirty Tricks arming flows',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/HUD_Message_Sequence',
	notes: 'Only used in early development builds; retail ships six DT* sequences in HUDMESSAGESEQUENCES.HMSC. Removed from Remastered on PS4 but reintroduced on PC and Switch.',

	parseRaw(raw, ctx) {
		return parseHudMessageSequence(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeHudMessageSequence(model, ctx.littleEndian);
	},
	describe(model) {
		return `"${model.macSequenceId}": ${model.messages.length} message${model.messages.length === 1 ? '' : 's'} (${messageChain(model)}), priority ${model.miPriority}`;
	},

	picker: {
		labelOf(model, { name }) {
			if (model == null) {
				return {
					primary: name,
					secondary: 'parse failed',
					badges: [{ label: 'parse failed', tone: 'warn' }],
				};
			}
			if (model.messages.length === 0) {
				return {
					primary: model.macSequenceId,
					secondary: 'no messages',
					badges: [{ label: 'empty', tone: 'muted' }],
				};
			}
			return {
				primary: model.macSequenceId,
				secondary: messageChain(model),
			};
		},
		sortKeys: [
			{ id: 'name', label: 'Name (A→Z)', compare: compareByName },
			{ id: 'index', label: 'Bundle order', compare: (a, b) => a.ctx.index - b.ctx.index },
			{
				id: 'messages-desc',
				label: 'Message count (high→low)',
				compare: (a, b) => (b.model?.messages.length ?? -1) - (a.model?.messages.length ?? -1),
			},
		],
		defaultSort: 'name',
		searchText(model, ctx) {
			if (model == null) return ctx.name;
			return `${model.macSequenceId} ${messageChain(model)}`;
		},
	},

	fixtures: [
		// The auto suite only exercises the first sequence in bundle order
		// (DTArmBtLk). All six, plus the dictionary↔sequence name relationship,
		// are covered in __tests__/hudMessageSequences.test.ts.
		{ bundle: 'example/HUDMESSAGESEQUENCES.HMSC', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.messages.length !== before.messages.length) {
					problems.push(`message count ${after.messages.length} != ${before.messages.length}`);
				}
				if (after.macSequenceId !== before.macSequenceId) {
					problems.push(`macSequenceId "${after.macSequenceId}" != "${before.macSequenceId}"`);
				}
				return problems;
			},
		},
		{
			name: 'edit-message-length',
			description: 'change messages[0] display duration from the retail 5 s and verify it survives round-trip',
			mutate: (m) => {
				const messages = m.messages.slice();
				messages[0] = { ...messages[0], mfMessageLength: 7.5 };
				return { ...m, messages };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (Math.abs(after.messages[0].mfMessageLength - 7.5) > 1e-4) {
					problems.push(`mfMessageLength = ${after.messages[0].mfMessageLength}, expected 7.5`);
				}
				return problems;
			},
		},
		{
			name: 'rename-sequence',
			description: 'rename the sequence and update its hash the way the schema derive hook does; both must survive',
			mutate: (m) => ({
				...m,
				macSequenceId: 'StressSeq',
				mSequenceIdHash: encodeCgsId('STRESSSEQ'),
			}),
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.macSequenceId !== 'StressSeq') {
					problems.push(`macSequenceId "${after.macSequenceId}", expected "StressSeq"`);
				}
				// The hash is uppercase-folded — pin the relationship so a writer
				// regression that re-encodes the mixed-case name gets caught.
				if (after.mSequenceIdHash !== encodeCgsId('STRESSSEQ')) {
					problems.push(`mSequenceIdHash 0x${after.mSequenceIdHash.toString(16)} != encodeCgsId('STRESSSEQ')`);
				}
				return problems;
			},
		},
		{
			name: 'append-message',
			description: 'append a third message — miMessageCount is recomputed and one default slot is consumed',
			mutate: (m) => ({
				...m,
				messages: [
					...m.messages,
					{
						mMessageId: encodeCgsId('STRESSMSG'),
						mfMessageLength: DEFAULT_MESSAGE_LENGTH_SECONDS,
						maiParam1Ids: [-1, -1, -1, -1],
						maiParam2Ids: [-1, -1, -1, -1],
						_pad2C: 0,
					},
				],
			}),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.messages.length !== afterMutate.messages.length) {
					problems.push(`message count ${afterReparse.messages.length} != ${afterMutate.messages.length}`);
				}
				if (afterReparse.messages.length > SEQUENCE_MESSAGE_SLOTS) {
					problems.push(`message count overflows the fixed ${SEQUENCE_MESSAGE_SLOTS} slots`);
				}
				const last = afterReparse.messages[afterReparse.messages.length - 1];
				if (last.mMessageId !== encodeCgsId('STRESSMSG')) {
					problems.push(`appended message id 0x${last.mMessageId.toString(16)} != encodeCgsId('STRESSMSG')`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-message',
			description: 'drop the final message — its slot must reparse as default-initialised, not stale',
			mutate: (m) => ({ ...m, messages: m.messages.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.messages.length !== afterMutate.messages.length) {
					problems.push(`message count ${afterReparse.messages.length} != ${afterMutate.messages.length}`);
				}
				return problems;
			},
		},
	],
};
