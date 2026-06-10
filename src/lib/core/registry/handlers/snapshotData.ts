// SnapshotData registry handler — thin wrapper around parseSnapshotData /
// writeSnapshotData in src/lib/core/snapshotData.ts.
//
// One resource per Nicotine bundle (NicotineAssetMain.mss / .Surround.mss).
// Each channel record references a MASTER mix channel of the companion
// Nicotine map (0xA024) by its exact MIXCHID word; each snapshot is one
// mixer preset carrying a (control, value) datum per channel. The two
// retail resources are byte-identical (17 snapshots × 72 channels) — the
// stereo/surround differences live entirely in the Nicotine maps.

import { parseSnapshotData, writeSnapshotData, type ParsedSnapshotData } from '../../snapshotData';
import type { ResourceHandler } from '../handler';

export const snapshotDataHandler: ResourceHandler<ParsedSnapshotData> = {
	typeId: 0xa029,
	key: 'snapshotData',
	name: 'Snapshot Data',
	description: 'Mixer-channel snapshots for the companion Nicotine map — each snapshot is one mixer preset with a (control, value) datum per referenced master mix channel',
	category: 'Audio',
	caps: { read: true, write: true },
	wikiUrl: 'https://burnout.wiki/wiki/Snapshot_Data',
	notes: 'Channels reference the companion Nicotine map\'s master mix channels by MIXCHID — removing or renumbering channels there orphans snapshot data here.',

	parseRaw(raw, ctx) {
		return parseSnapshotData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeSnapshotData(model, ctx.littleEndian);
	},
	describe(model) {
		return `${model.snapshots.length} snapshots × ${model.channels.length} channels`;
	},

	fixtures: [
		{ bundle: 'example/SOUND/NICOTINEASSETMAIN.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
		{ bundle: 'example/SOUND/NICOTINEASSETSURROUND.BUNDLE', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.channels.length !== before.channels.length) {
					problems.push(`channel count ${after.channels.length} != ${before.channels.length}`);
				}
				if (after.snapshots.length !== before.snapshots.length) {
					problems.push(`snapshot count ${after.snapshots.length} != ${before.snapshots.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-snapshot-value',
			description: 'change snapshots[0].entries[0].value (possibly a volume) and verify it survives',
			mutate: (m) => {
				m.snapshots[0].entries[0].value = 0.75;
				return m;
			},
			verify: (_afterMutate, afterReparse) => {
				const v = afterReparse.snapshots[0]?.entries[0]?.value;
				return Math.abs((v ?? NaN) - 0.75) < 1e-6 ? [] : [`value = ${v}, expected 0.75`];
			},
		},
		{
			name: 'edit-control-word',
			description: 'change snapshots[0].entries[0].control and verify it survives alongside an untouched value',
			mutate: (m) => {
				m.snapshots[0].entries[0].control = 60000;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.snapshots[0]?.entries[0]?.control !== 60000) {
					problems.push(`control = ${afterReparse.snapshots[0]?.entries[0]?.control}, expected 60000`);
				}
				if (afterReparse.snapshots[0]?.entries[0]?.value !== afterMutate.snapshots[0].entries[0].value) {
					problems.push('value changed');
				}
				return problems;
			},
		},
		{
			name: 'remove-last-snapshot',
			description: 'drop the final snapshot — miNumSnapshots, dataSize, and the alignment pad are all re-derived',
			mutate: (m) => ({ ...m, snapshots: m.snapshots.slice(0, -1) }),
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.snapshots.length !== afterMutate.snapshots.length) {
					problems.push(`snapshot count ${afterReparse.snapshots.length} != ${afterMutate.snapshots.length}`);
				}
				if (afterReparse.channels.length !== afterMutate.channels.length) {
					problems.push(`channel count ${afterReparse.channels.length} != ${afterMutate.channels.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-channel-id',
			description: 'change channels[0].channelId (the hash-like id) and verify it survives with mixChId untouched',
			mutate: (m) => {
				m.channels[0].channelId = 0xdeadbeef;
				return m;
			},
			verify: (afterMutate, afterReparse) => {
				const problems: string[] = [];
				if (afterReparse.channels[0]?.channelId !== 0xdeadbeef) {
					problems.push(`channelId = 0x${afterReparse.channels[0]?.channelId.toString(16)}, expected 0xdeadbeef`);
				}
				if (afterReparse.channels[0]?.mixChId !== afterMutate.channels[0].mixChId) {
					problems.push('mixChId changed');
				}
				return problems;
			},
		},
	],
};
