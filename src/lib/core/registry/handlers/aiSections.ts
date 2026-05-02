// AISections registry handler.

import {
	parseAISectionsData,
	writeAISectionsData,
	type ParsedAISections,
	type ParsedAISectionsV12,
	type AISection,
	type Portal,
	type BoundaryLine,
	SectionSpeed,
	AISectionFlag,
	EResetSpeedType,
} from '../../aiSections';
import { HANDLER_PLATFORM, type ResourceHandler, type StressScenario } from '../handler';

export const aiSectionsHandler: ResourceHandler<ParsedAISections> = {
	typeId: 0x10001,
	key: 'aiSections',
	name: 'AI Sections',
	description: 'AI navigation mesh — sections, portals, boundary lines, speed and shortcut data',
	category: 'Data',
	caps: {
		read: true,
		write: true,
		// X360 (BE) is supported for the Burnout 5 prototype legacy V4/V6
		// payload — the only X360 fixture we have. The retail v12 writer
		// is endian-clean too, so promoting this is safe.
		writePlatforms: [HANDLER_PLATFORM.PC, HANDLER_PLATFORM.XBOX360, HANDLER_PLATFORM.PS3],
	},

	parseRaw(raw, ctx) {
		return parseAISectionsData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeAISectionsData(model, ctx.littleEndian);
	},
	describe(model) {
		if (model.kind === 'v4' || model.kind === 'v6') {
			const sec = model.legacy.sections;
			let portalCount = 0, noGoCount = 0;
			for (const s of sec) { portalCount += s.portals.length; noGoCount += s.noGoLines.length; }
			return `legacy v${model.version}, sections ${sec.length}, portals ${portalCount}, noGoLines ${noGoCount}`;
		}
		const shortcutCount = model.sections.filter(s => s.flags & AISectionFlag.SHORTCUT).length;
		const junctionCount = model.sections.filter(s => s.flags & AISectionFlag.JUNCTION).length;
		return `v${model.version}, sections ${model.sections.length}, resetPairs ${model.sectionResetPairs.length}, shortcuts ${shortcutCount}, junctions ${junctionCount}`;
	},
	fixtures: [
		{
			bundle: 'example/AI.DAT',
			expect: { parseOk: true, byteRoundTrip: true, stableWriter: true },
		},
		{
			bundle: 'example/ps3/AI.DAT',
			expect: { parseOk: true, byteRoundTrip: true, stableWriter: true },
		},
		// Burnout 5 prototype dev build (X360, BE) — version 4 legacy layout
		// with inline corners and no reset-pair table. Routed through
		// aiSectionsLegacy.ts and parsed into the `kind: 'v4'` variant.
		{
			bundle: 'example/older builds/AI.dat',
			expect: { parseOk: true, byteRoundTrip: true, stableWriter: true },
		},
	],

	// All scenarios target the retail (v12) shape — they read `sections[0].id`,
	// mutate `sectionResetPairs`, etc. The wrapper at the bottom no-ops the
	// scenario when the model is V4/V6 prototype data; legacy mutation
	// coverage is the next slice (see issue #32 follow-ups).
	stressScenarios: ([
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sections.length !== before.sections.length) {
					problems.push(`sections count ${after.sections.length} != ${before.sections.length}`);
				}
				if (after.sectionResetPairs.length !== before.sectionResetPairs.length) {
					problems.push(`resetPairs count ${after.sectionResetPairs.length} != ${before.sectionResetPairs.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-first-section-speed',
			description: 'set sections[0].speed to VERY_FAST and verify it survives round-trip',
			mutate: (m) => {
				const sections = m.sections.slice();
				sections[0] = { ...sections[0], speed: SectionSpeed.E_SECTION_SPEED_VERY_FAST };
				return { ...m, sections };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.sections[0].speed !== SectionSpeed.E_SECTION_SPEED_VERY_FAST) {
					problems.push(`sections[0].speed = ${after.sections[0].speed}, expected ${SectionSpeed.E_SECTION_SPEED_VERY_FAST}`);
				}
				return problems;
			},
		},
		{
			name: 'toggle-first-section-flags',
			description: 'xor sections[0].flags with SHORTCUT and verify the bit flip survives',
			mutate: (m) => {
				const sections = m.sections.slice();
				sections[0] = { ...sections[0], flags: (sections[0].flags ^ AISectionFlag.SHORTCUT) & 0xFF };
				return { ...m, sections };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sections[0].flags !== before.sections[0].flags) {
					problems.push(`sections[0].flags = 0x${after.sections[0].flags.toString(16)}, expected 0x${before.sections[0].flags.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-section',
			description: 'pop sections[-1]',
			mutate: (m) => ({ ...m, sections: m.sections.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sections.length !== before.sections.length) {
					problems.push(`section count ${after.sections.length} != ${before.sections.length}`);
				}
				return problems;
			},
		},
		{
			name: 'remove-last-reset-pair',
			description: 'pop sectionResetPairs[-1]',
			mutate: (m) => ({ ...m, sectionResetPairs: m.sectionResetPairs.slice(0, -1) }),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sectionResetPairs.length !== before.sectionResetPairs.length) {
					problems.push(`resetPairs count ${after.sectionResetPairs.length} != ${before.sectionResetPairs.length}`);
				}
				return problems;
			},
		},
		{
			name: 'edit-first-section-id',
			description: 'set sections[0].id to a marker and verify it survives round-trip',
			mutate: (m) => {
				const sections = m.sections.slice();
				sections[0] = { ...sections[0], id: 0xDEADBEEF };
				return { ...m, sections };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				if (after.sections[0].id !== 0xDEADBEEF) {
					problems.push(`sections[0].id = 0x${after.sections[0].id.toString(16)}`);
				}
				return problems;
			},
		},
		{
			name: 'add-section',
			description: 'append a fully-populated new section with portals, nogo lines, and corners',
			mutate: (m) => {
				const bl: BoundaryLine = { verts: { x: 1.0, y: 2.0, z: 3.0, w: 4.0 } };
				const portal: Portal = {
					position: { x: -100.5, y: 50.25, z: -200.75 },
					boundaryLines: [bl],
					linkSection: 0,
				};
				const added: AISection = {
					portals: [portal],
					noGoLines: [bl, { verts: { x: 5.0, y: 6.0, z: 7.0, w: 8.0 } }],
					corners: [
						{ x: -10, y: -20 },
						{ x: 10, y: -20 },
						{ x: 10, y: 20 },
						{ x: -10, y: 20 },
					],
					id: 0xCAFEBABE,
					spanIndex: 42,
					speed: SectionSpeed.E_SECTION_SPEED_FAST,
					district: 0,
					flags: AISectionFlag.JUNCTION | AISectionFlag.SHORTCUT,
				};
				return { ...m, sections: [...m.sections, added] };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sections.length !== before.sections.length) {
					problems.push(`length ${after.sections.length} != ${before.sections.length}`);
				}
				const s = after.sections[after.sections.length - 1];
				if (s.id !== 0xCAFEBABE) problems.push(`id = 0x${s.id.toString(16)}`);
				if (s.spanIndex !== 42) problems.push(`spanIndex = ${s.spanIndex}`);
				if (s.speed !== SectionSpeed.E_SECTION_SPEED_FAST) problems.push(`speed = ${s.speed}`);
				if (s.flags !== (AISectionFlag.JUNCTION | AISectionFlag.SHORTCUT)) problems.push(`flags = 0x${s.flags.toString(16)}`);
				if (s.portals.length !== 1) problems.push(`portals.length = ${s.portals.length}`);
				if (s.noGoLines.length !== 2) problems.push(`noGoLines.length = ${s.noGoLines.length}`);
				if (s.corners.length !== 4) problems.push(`corners.length = ${s.corners.length}`);
				if (s.portals.length === 1) {
					const p = s.portals[0];
					if (p.position.x !== -100.5) problems.push(`portal.pos.x = ${p.position.x}`);
					if (p.boundaryLines.length !== 1) problems.push(`portal.BLs = ${p.boundaryLines.length}`);
					if (p.linkSection !== 0) problems.push(`portal.link = ${p.linkSection}`);
				}
				return problems;
			},
		},
		{
			name: 'add-reset-pair',
			description: 'append a new reset pair and verify it survives round-trip',
			mutate: (m) => ({
				...m,
				sectionResetPairs: [...m.sectionResetPairs, {
					resetSpeed: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_REVERSE,
					startSectionIndex: 100,
					resetSectionIndex: 200,
				}],
			}),
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sectionResetPairs.length !== before.sectionResetPairs.length) {
					problems.push(`length ${after.sectionResetPairs.length} != ${before.sectionResetPairs.length}`);
				}
				const rp = after.sectionResetPairs[after.sectionResetPairs.length - 1];
				if (rp.resetSpeed !== EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_REVERSE) problems.push(`resetSpeed = ${rp.resetSpeed}`);
				if (rp.startSectionIndex !== 100) problems.push(`start = ${rp.startSectionIndex}`);
				if (rp.resetSectionIndex !== 200) problems.push(`reset = ${rp.resetSectionIndex}`);
				return problems;
			},
		},
		{
			name: 'swap-first-two-sections',
			description: 'swap sections[0] and sections[1] and verify order survives',
			mutate: (m) => {
				const sections = m.sections.slice();
				[sections[0], sections[1]] = [sections[1], sections[0]];
				return { ...m, sections };
			},
			verify: (before, after) => {
				const problems: string[] = [];
				if (after.sections[0].id !== before.sections[0].id) {
					problems.push(`after[0].id = 0x${after.sections[0].id.toString(16)}, expected 0x${before.sections[0].id.toString(16)}`);
				}
				if (after.sections[1].id !== before.sections[1].id) {
					problems.push(`after[1].id = 0x${after.sections[1].id.toString(16)}, expected 0x${before.sections[1].id.toString(16)}`);
				}
				return problems;
			},
		},
	] as StressScenario<ParsedAISectionsV12>[]).map((s): StressScenario<ParsedAISections> => ({
		name: s.name,
		description: s.description,
		mutate: (m) => (m.kind === 'v12' ? s.mutate(m) : m),
		verify: s.verify
			? (a, b) => (a.kind !== 'v12' || b.kind !== 'v12' ? [] : s.verify!(a, b))
			: undefined,
	})),
};
