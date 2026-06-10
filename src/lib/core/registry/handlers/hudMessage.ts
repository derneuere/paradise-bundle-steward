// HudMessage registry handler — thin wrapper around
// parseHudMessage / writeHudMessage in src/lib/core/hudMessage.ts.
//
// Retail ships exactly ONE resource of this type (HUDMESSAGES.HM, 308
// messages), so no picker config. The game fires messages by mMessageIdHash,
// which must stay equal to encodeCgsId(macMessageId.toUpperCase()) — the
// rename scenario below keeps the pair in sync the way the schema layer does.

import { parseHudMessage, writeHudMessage, type ParsedHudMessage } from '../../hudMessage';
import { encodeCgsId } from '../../cgsid';
import type { ResourceHandler } from '../handler';

// ≤12 chars and absent from retail, so the rename scenario provably changes
// both the id and its derived CgsID.
const STRESS_MESSAGE_ID = 'StewardTest';

export const hudMessageHandler: ResourceHandler<ParsedHudMessage> = {
	typeId: 0x2c,
	key: 'hudMessage',
	name: 'HUD Message',
	description: 'The in-game HUD message catalogue — every message the HUD can flash at the player (takedowns, road rules, challenges, …), each with up to three Language-string lines, a display style, an icon, and availability rules',
	category: 'Data',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/HUD_Message',

	parseRaw(raw, ctx) {
		return parseHudMessage(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeHudMessage(model, ctx.littleEndian);
	},
	describe(model) {
		const styles = new Set(model.messages.map((m) => m.macMessageStyle)).size;
		return `${model.messages.length} messages, ${styles} styles`;
	},

	fixtures: [
		{ bundle: 'example/HUDMESSAGES.HM', expect: { parseOk: true, byteRoundTrip: true } },
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
				return problems;
			},
		},
		{
			name: 'edit-timing-and-availability',
			description: 'change messages[0] duration/wait and availability bits; verify they survive round-trip',
			mutate: (m) => {
				const messages = m.messages.slice();
				messages[0] = { ...messages[0], mfDuration: 9.25, mfTimeToWait: 1.5, muAvailabilityBitSet: 0x2d };
				return { ...m, messages };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				const a = afterMutate.messages[0];
				const b = afterReparse.messages[0];
				if (b.mfDuration !== a.mfDuration) problems.push(`mfDuration = ${b.mfDuration}, expected ${a.mfDuration}`);
				if (b.mfTimeToWait !== a.mfTimeToWait) problems.push(`mfTimeToWait = ${b.mfTimeToWait}, expected ${a.mfTimeToWait}`);
				if (b.muAvailabilityBitSet !== a.muAvailabilityBitSet) {
					problems.push(`muAvailabilityBitSet = 0x${b.muAvailabilityBitSet.toString(16)}, expected 0x${a.muAvailabilityBitSet.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'rename-message-id',
			description: 'rename messages[0] and recompute its CgsID the way the game expects; verify both survive',
			mutate: (m) => {
				const messages = m.messages.slice();
				messages[0] = {
					...messages[0],
					macMessageId: STRESS_MESSAGE_ID,
					mMessageIdHash: encodeCgsId(STRESS_MESSAGE_ID.toUpperCase()),
				};
				return { ...m, messages };
			},
			verify: (_afterMutate, afterReparse) => {
				const problems: string[] = [];
				const b = afterReparse.messages[0];
				if (b.macMessageId !== STRESS_MESSAGE_ID) problems.push(`macMessageId = "${b.macMessageId}"`);
				if (b.mMessageIdHash !== encodeCgsId(STRESS_MESSAGE_ID.toUpperCase())) {
					problems.push(`mMessageIdHash = 0x${b.mMessageIdHash.toString(16)} out of sync with the id`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-message',
			description: 'drop the final message; the pointer array, section pads, and size header must all shrink consistently',
			mutate: (m) => ({ ...m, messages: m.messages.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.messages.length !== afterMutate.messages.length) {
					problems.push(`message count ${afterReparse.messages.length} != ${afterMutate.messages.length}`);
				}
				const last = afterReparse.messages[afterReparse.messages.length - 1];
				const expected = afterMutate.messages[afterMutate.messages.length - 1];
				if (last.macMessageId !== expected.macMessageId) {
					problems.push(`last message is "${last.macMessageId}", expected "${expected.macMessageId}"`);
				}
				return problems;
			},
		},
		{
			name: 'append-cloned-message',
			description: 'append a renamed clone of messages[0]; grows the pointer array across the 128-byte section alignment',
			mutate: (m) => {
				const clone = {
					...m.messages[0],
					lines: m.messages[0].lines.map((l) => ({ ...l, maeParamTypes: l.maeParamTypes.slice() })),
					macMessageId: STRESS_MESSAGE_ID,
					mMessageIdHash: encodeCgsId(STRESS_MESSAGE_ID.toUpperCase()),
				};
				return { ...m, messages: [...m.messages, clone] };
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.messages.length !== afterMutate.messages.length) {
					problems.push(`message count ${afterReparse.messages.length} != ${afterMutate.messages.length}`);
				}
				const last = afterReparse.messages[afterReparse.messages.length - 1];
				if (last.macMessageId !== STRESS_MESSAGE_ID) {
					problems.push(`appended message id "${last.macMessageId}", expected "${STRESS_MESSAGE_ID}"`);
				}
				return problems;
			},
		},
	],
};
