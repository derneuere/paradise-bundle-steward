// VehicleList registry handler.
//
// The writer was rewritten to byte-exact round-trip against the reference
// VEHICLELIST.BUNDLE fixture in April 2026. Fixes that enabled byteRoundTrip:
//   - dropped double zlib compression (writeBundleFresh already compresses)
//   - removed `.trim()` in decodeString (was losing whitespace in 1/1500 strings)
//   - switched unknownData to number[] so CLI dump/pack round-trips via JSON
//   - stopped silently dropping entries with empty names / zero ids
//   - preserved header.startOffset instead of hardcoding 16

import {
	parseVehicleListData,
	writeVehicleListData,
	type ParsedVehicleList,
	type VehicleListEntry,
	VehicleType,
	CarType,
	LiveryType,
	Rank,
	AIEngineStream,
} from '../../vehicleList';
import type { ResourceHandler } from '../handler';

export const vehicleListHandler: ResourceHandler<ParsedVehicleList> = {
	typeId: 0x10005,
	key: 'vehicleList',
	name: 'Vehicle List',
	description: 'Complete list of vehicles with gameplay stats, audio config, and unlock metadata',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseVehicleListData(raw, { littleEndian: ctx.littleEndian });
	},
	writeRaw(model, ctx) {
		return writeVehicleListData(model, ctx.littleEndian);
	},
	describe(model) {
		return `vehicles ${model.vehicles.length}`;
	},
	fixtures: [
		// VEHICLELIST.BUNDLE contains both a VehicleList and a PlayerCarColours
		// resource. byteRoundTrip and stableWriter both hold post-rewrite.
		{
			bundle: 'example/VEHICLELIST.BUNDLE',
			expect: { parseOk: true, byteRoundTrip: true, stableWriter: true },
		},
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.vehicles.length !== before.vehicles.length) {
					problems.push(`vehicles count ${after.vehicles.length} != ${before.vehicles.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-first-name',
			description: 'rename vehicles[0].vehicleName to a known marker',
			mutate: (m) => {
				const vehicles = m.vehicles.slice();
				vehicles[0] = { ...vehicles[0], vehicleName: 'StressTestCar' };
				return { ...m, vehicles };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.vehicles[0].vehicleName !== 'StressTestCar') {
					problems.push(`vehicles[0].vehicleName = "${after.vehicles[0].vehicleName}"`);
				}
				return problems;
			},
		},
		{
			name: 'toggle-first-flags',
			description: 'xor vehicles[0].gamePlayData.flags with 0x1 and verify the bit flip survives round-trip',
			mutate: (m) => {
				const vehicles = m.vehicles.slice();
				const v0 = vehicles[0];
				vehicles[0] = {
					...v0,
					gamePlayData: { ...v0.gamePlayData, flags: (v0.gamePlayData.flags ^ 0x1) >>> 0 },
				};
				return { ...m, vehicles };
			},
			verify: (before, after) => {
				// `before` is the post-mutate model (flags already toggled).
				// The reparsed value must match it.
				const problems: string[] = [];
				if (after.vehicles[0].gamePlayData.flags !== before.vehicles[0].gamePlayData.flags) {
					problems.push(
						`vehicles[0].flags = 0x${after.vehicles[0].gamePlayData.flags.toString(16)}, expected 0x${before.vehicles[0].gamePlayData.flags.toString(16)}`,
					);
				}
				return problems;
			},
		},
		{
			name: 'swap-first-two',
			description: 'swap vehicles[0] and vehicles[1] and verify the order survives round-trip',
			mutate: (m) => {
				const vehicles = m.vehicles.slice();
				[vehicles[0], vehicles[1]] = [vehicles[1], vehicles[0]];
				return { ...m, vehicles };
			},
			verify: (before, after) => {
				// `before` is the post-swap model, `after` is the model we get
				// back after a write+parse cycle. They should match position by
				// position — the swap order must survive round-trip.
				const problems: string[] = [];
				if (after.vehicles[0].id !== before.vehicles[0].id) {
					problems.push(`after[0].id = ${after.vehicles[0].id}, expected ${before.vehicles[0].id}`);
				}
				if (after.vehicles[1].id !== before.vehicles[1].id) {
					problems.push(`after[1].id = ${after.vehicles[1].id}, expected ${before.vehicles[1].id}`);
				}
				return problems;
			},
		},
		{
			name: 'bulk-zero-colors',
			description: 'set every vehicle colorIndex and paletteIndex to 0',
			mutate: (m) => ({
				...m,
				vehicles: m.vehicles.map((v) => ({ ...v, colorIndex: 0, paletteIndex: 0 })),
			}),
			verify: (_before, after) => {
				const problems: string[] = [];
				for (let i = 0; i < after.vehicles.length; i++) {
					if (after.vehicles[i].colorIndex !== 0 || after.vehicles[i].paletteIndex !== 0) {
						problems.push(
							`vehicles[${i}] colors = (${after.vehicles[i].colorIndex}, ${after.vehicles[i].paletteIndex})`,
						);
						break;
					}
				}
				return problems;
			},
		},
		{
			name: 'add-vehicle',
			description: 'append a fully-populated brand-new vehicle and verify every field round-trips',
			mutate: (m) => {
				const added: VehicleListEntry = {
					id: 0xAABBCCDDEEFF0011n,
					parentId: 0x1122334455667788n,
					vehicleName: 'StressAdded',
					manufacturer: 'StressCo',
					wheelName: 'StressWheel',
					gamePlayData: {
						damageLimit: 1.0,
						flags: 0x12345,
						boostBarLength: 7,
						unlockRank: Rank.C_CLASS,
						boostCapacity: 9,
						strengthStat: 4,
					},
					attribCollectionKey: 0xDEADBEEFCAFEBABEn,
					audioData: {
						exhaustName: 0x0102030405060708n,
						exhaustEntityKey: 0x1111111122222222n,
						engineEntityKey: 0x3333333344444444n,
						engineName: 0x55555555aaaaaaaan,
						rivalUnlockName: 'SuperClassUnlock',
						wonCarVoiceOverKey: 0x6666666677777777n,
						rivalReleasedVoiceOverKey: 0x8888888899999999n,
						aiMusicLoopContentSpec: 'AI_Super_music1',
						aiExhaustIndex: AIEngineStream.AI_GT_ENG,
						aiExhaustIndex2ndPick: AIEngineStream.AIROD_EX,
						aiExhaustIndex3rdPick: AIEngineStream.AI_F1_EX,
					},
					unknownData: new Array(16).fill(0),
					category: 0x4, // Online Cars
					vehicleType: VehicleType.CAR,
					boostType: CarType.AGGRESSION,
					liveryType: LiveryType.GOLD,
					topSpeedNormal: 140,
					topSpeedBoost: 180,
					topSpeedNormalGUIStat: 7,
					topSpeedBoostGUIStat: 8,
					colorIndex: 3,
					paletteIndex: 2,
				};
				return {
					...m,
					vehicles: [...m.vehicles, added],
					header: { ...m.header, numVehicles: m.vehicles.length + 1 },
				};
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.vehicles.length !== before.vehicles.length) {
					problems.push(`length ${after.vehicles.length} != ${before.vehicles.length}`);
				}
				if (after.header.numVehicles !== before.header.numVehicles) {
					problems.push(`header.numVehicles ${after.header.numVehicles} != ${before.header.numVehicles}`);
				}
				// Every field on the appended vehicle must survive round-trip.
				// `before` is the post-mutate model so the new row is the last
				// element of before.vehicles; we compare field-by-field against
				// the matching after row.
				const expected = before.vehicles[before.vehicles.length - 1];
				const actual = after.vehicles[after.vehicles.length - 1];
				const eq = (path: string, a: unknown, b: unknown) => {
					if (a !== b) problems.push(`${path}: ${String(a)} != ${String(b)}`);
				};
				eq('id', actual.id, expected.id);
				eq('parentId', actual.parentId, expected.parentId);
				eq('vehicleName', actual.vehicleName, expected.vehicleName);
				eq('manufacturer', actual.manufacturer, expected.manufacturer);
				eq('wheelName', actual.wheelName, expected.wheelName);
				eq('gamePlayData.damageLimit', actual.gamePlayData.damageLimit, expected.gamePlayData.damageLimit);
				eq('gamePlayData.flags', actual.gamePlayData.flags, expected.gamePlayData.flags);
				eq('gamePlayData.boostBarLength', actual.gamePlayData.boostBarLength, expected.gamePlayData.boostBarLength);
				eq('gamePlayData.unlockRank', actual.gamePlayData.unlockRank, expected.gamePlayData.unlockRank);
				eq('gamePlayData.boostCapacity', actual.gamePlayData.boostCapacity, expected.gamePlayData.boostCapacity);
				eq('gamePlayData.strengthStat', actual.gamePlayData.strengthStat, expected.gamePlayData.strengthStat);
				eq('attribCollectionKey', actual.attribCollectionKey, expected.attribCollectionKey);
				eq('audioData.exhaustName', actual.audioData.exhaustName, expected.audioData.exhaustName);
				eq('audioData.exhaustEntityKey', actual.audioData.exhaustEntityKey, expected.audioData.exhaustEntityKey);
				eq('audioData.engineEntityKey', actual.audioData.engineEntityKey, expected.audioData.engineEntityKey);
				eq('audioData.engineName', actual.audioData.engineName, expected.audioData.engineName);
				eq('audioData.rivalUnlockName', actual.audioData.rivalUnlockName, expected.audioData.rivalUnlockName);
				eq('audioData.wonCarVoiceOverKey', actual.audioData.wonCarVoiceOverKey, expected.audioData.wonCarVoiceOverKey);
				eq('audioData.rivalReleasedVoiceOverKey', actual.audioData.rivalReleasedVoiceOverKey, expected.audioData.rivalReleasedVoiceOverKey);
				eq('audioData.aiMusicLoopContentSpec', actual.audioData.aiMusicLoopContentSpec, expected.audioData.aiMusicLoopContentSpec);
				eq('audioData.aiExhaustIndex', actual.audioData.aiExhaustIndex, expected.audioData.aiExhaustIndex);
				eq('audioData.aiExhaustIndex2ndPick', actual.audioData.aiExhaustIndex2ndPick, expected.audioData.aiExhaustIndex2ndPick);
				eq('audioData.aiExhaustIndex3rdPick', actual.audioData.aiExhaustIndex3rdPick, expected.audioData.aiExhaustIndex3rdPick);
				eq('category', actual.category, expected.category);
				eq('vehicleType', actual.vehicleType, expected.vehicleType);
				eq('boostType', actual.boostType, expected.boostType);
				eq('liveryType', actual.liveryType, expected.liveryType);
				eq('topSpeedNormal', actual.topSpeedNormal, expected.topSpeedNormal);
				eq('topSpeedBoost', actual.topSpeedBoost, expected.topSpeedBoost);
				eq('topSpeedNormalGUIStat', actual.topSpeedNormalGUIStat, expected.topSpeedNormalGUIStat);
				eq('topSpeedBoostGUIStat', actual.topSpeedBoostGUIStat, expected.topSpeedBoostGUIStat);
				eq('colorIndex', actual.colorIndex, expected.colorIndex);
				eq('paletteIndex', actual.paletteIndex, expected.paletteIndex);
				return problems;
			},
		},
		{
			name: 'remove-last-vehicle',
			description: 'pop the last vehicle and decrement header.numVehicles',
			mutate: (m) => ({
				...m,
				vehicles: m.vehicles.slice(0, -1),
				header: { ...m.header, numVehicles: m.vehicles.length - 1 },
			}),
			verify: (before, after) => {
				// `before` is the post-mutation model (vehicles already popped).
				// The round-trip should preserve that exact state.
				const problems: string[] = [];
				if (after.vehicles.length !== before.vehicles.length) {
					problems.push(`length ${after.vehicles.length} != ${before.vehicles.length}`);
				}
				if (after.header.numVehicles !== before.header.numVehicles) {
					problems.push(`header.numVehicles ${after.header.numVehicles} != ${before.header.numVehicles}`);
				}
				return problems;
			},
		},
	],
};
