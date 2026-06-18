// AttribSysVault registry handler — thin wrapper around parseAttribSys /
// writeAttribSys in src/lib/core/attribSys.ts.

import {
	parseAttribSys,
	writeAttribSys,
	type ParsedAttribSys,
} from '../../attribSys';
import type { ResourceHandler } from '../handler';

export const attribSysVaultHandler: ResourceHandler<ParsedAttribSys> = {
	typeId: 0x1C,
	key: 'attribSysVault',
	name: 'AttribSys Vault',
	description: 'AttribSys object database vault (vehicle physics, camera, engine attributes)',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseAttribSys(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeAttribSys(model, ctx.littleEndian);
	},
	describe(model) {
		const colls = model.collections.length;
		const strs = model.strings.join(', ');
		const parts = [`${colls} collections`, `strings=[${strs}]`];

		// Show vehicle-specific info if typed attributes are available
		const base = model.attributes.find(a => a.className === 'physicsvehiclebaseattribs');
		if (base) {
			const speed = base.fields.MaxSpeed as number;
			const mass = base.fields.DrivingMass as number;
			parts.push(`MaxSpeed=${speed.toFixed(1)}`, `Mass=${mass.toFixed(1)}`);
		}
		const boost = model.attributes.find(a => a.className === 'physicsvehicleboostattribs');
		if (boost) {
			parts.push(`BoostSpeed=${(boost.fields.MaxBoostSpeed as number).toFixed(1)}`);
		}

		return parts.join(', ');
	},

	fixtures: [
		{
			bundle: 'example/VEH_CARBRWDS_AT.BIN',
			expect: { parseOk: true, stableWriter: true },
		},
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises the writer on the read model unchanged',
			mutate: (m) => m,
		},

		// ── physics value edits ──
		{
			name: 'set-max-speed',
			description: 'set MaxSpeed to 250 and verify it survives round-trip',
			mutate: (m) => {
				const attrs = m.attributes.map(a =>
					a.className === 'physicsvehiclebaseattribs'
						? { ...a, fields: { ...a.fields, MaxSpeed: 250 } }
						: a,
				);
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const base = after.attributes.find(a => a.className === 'physicsvehiclebaseattribs');
				if (!base) return ['missing physicsvehiclebaseattribs'];
				return (base.fields.MaxSpeed as number) === 250
					? [] : [`MaxSpeed=${base.fields.MaxSpeed}, expected 250`];
			},
		},
		{
			name: 'set-boost-values',
			description: 'set MaxBoostSpeed=300, BoostBase=50 and verify round-trip',
			mutate: (m) => {
				const attrs = m.attributes.map(a =>
					a.className === 'physicsvehicleboostattribs'
						? { ...a, fields: { ...a.fields, MaxBoostSpeed: 300, BoostBase: 50 } }
						: a,
				);
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const boost = after.attributes.find(a => a.className === 'physicsvehicleboostattribs');
				if (!boost) return ['missing physicsvehicleboostattribs'];
				const problems: string[] = [];
				if ((boost.fields.MaxBoostSpeed as number) !== 300)
					problems.push(`MaxBoostSpeed=${boost.fields.MaxBoostSpeed}`);
				if ((boost.fields.BoostBase as number) !== 50)
					problems.push(`BoostBase=${boost.fields.BoostBase}`);
				return problems;
			},
		},
		{
			name: 'set-engine-torque',
			description: 'set MaxTorque=999 and MaxRPM=10000',
			mutate: (m) => {
				const attrs = m.attributes.map(a =>
					a.className === 'physicsvehicleengineattribs'
						? { ...a, fields: { ...a.fields, MaxTorque: 999, MaxRPM: 10000 } }
						: a,
				);
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const engine = after.attributes.find(a => a.className === 'physicsvehicleengineattribs');
				if (!engine) return ['missing physicsvehicleengineattribs'];
				const problems: string[] = [];
				if ((engine.fields.MaxTorque as number) !== 999)
					problems.push(`MaxTorque=${engine.fields.MaxTorque}`);
				if ((engine.fields.MaxRPM as number) !== 10000)
					problems.push(`MaxRPM=${engine.fields.MaxRPM}`);
				return problems;
			},
		},
		{
			name: 'set-driving-mass',
			description: 'set DrivingMass to 1500 (heavier vehicle)',
			mutate: (m) => {
				const attrs = m.attributes.map(a =>
					a.className === 'physicsvehiclebaseattribs'
						? { ...a, fields: { ...a.fields, DrivingMass: 1500 } }
						: a,
				);
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const base = after.attributes.find(a => a.className === 'physicsvehiclebaseattribs');
				if (!base) return ['missing physicsvehiclebaseattribs'];
				return (base.fields.DrivingMass as number) === 1500
					? [] : [`DrivingMass=${base.fields.DrivingMass}`];
			},
		},

		// ── camera edits ──
		{
			name: 'set-fov',
			description: 'set bumper camera FieldOfView to 90',
			mutate: (m) => {
				const attrs = m.attributes.map(a =>
					a.className === 'camerabumperbehaviour'
						? { ...a, fields: { ...a.fields, FieldOfView: 90 } }
						: a,
				);
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const cam = after.attributes.find(a => a.className === 'camerabumperbehaviour');
				if (!cam) return ['missing camerabumperbehaviour'];
				return (cam.fields.FieldOfView as number) === 90
					? [] : [`FieldOfView=${cam.fields.FieldOfView}`];
			},
		},

		// ── drift edits ──
		{
			name: 'set-drift-params',
			description: 'set DriftMaxAngle=60, MinSpeedForDrift=20',
			mutate: (m) => {
				const attrs = m.attributes.map(a =>
					a.className === 'physicsvehicledriftattribs'
						? { ...a, fields: { ...a.fields, DriftMaxAngle: 60, MinSpeedForDrift: 20 } }
						: a,
				);
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const drift = after.attributes.find(a => a.className === 'physicsvehicledriftattribs');
				if (!drift) return ['missing physicsvehicledriftattribs'];
				const problems: string[] = [];
				if ((drift.fields.DriftMaxAngle as number) !== 60)
					problems.push(`DriftMaxAngle=${drift.fields.DriftMaxAngle}`);
				if ((drift.fields.MinSpeedForDrift as number) !== 20)
					problems.push(`MinSpeedForDrift=${drift.fields.MinSpeedForDrift}`);
				return problems;
			},
		},

		// ── multi-attribute edit ──
		{
			name: 'full-tune',
			description: 'edit values across engine, base, boost, and drift simultaneously',
			mutate: (m) => {
				const attrs = m.attributes.map(a => {
					switch (a.className) {
						case 'physicsvehiclebaseattribs':
							return { ...a, fields: { ...a.fields, MaxSpeed: 350, DrivingMass: 700 } };
						case 'physicsvehicleengineattribs':
							return { ...a, fields: { ...a.fields, MaxTorque: 600, MaxRPM: 9500 } };
						case 'physicsvehicleboostattribs':
							return { ...a, fields: { ...a.fields, MaxBoostSpeed: 400 } };
						case 'physicsvehicledriftattribs':
							return { ...a, fields: { ...a.fields, DriftMaxAngle: 75 } };
						default: return a;
					}
				});
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const problems: string[] = [];
				const base = after.attributes.find(a => a.className === 'physicsvehiclebaseattribs');
				const engine = after.attributes.find(a => a.className === 'physicsvehicleengineattribs');
				const boost = after.attributes.find(a => a.className === 'physicsvehicleboostattribs');
				const drift = after.attributes.find(a => a.className === 'physicsvehicledriftattribs');
				if (!base || !engine || !boost || !drift) return ['missing attribute class'];
				if ((base.fields.MaxSpeed as number) !== 350) problems.push(`MaxSpeed=${base.fields.MaxSpeed}`);
				if ((base.fields.DrivingMass as number) !== 700) problems.push(`DrivingMass=${base.fields.DrivingMass}`);
				if ((engine.fields.MaxTorque as number) !== 600) problems.push(`MaxTorque=${engine.fields.MaxTorque}`);
				if ((engine.fields.MaxRPM as number) !== 9500) problems.push(`MaxRPM=${engine.fields.MaxRPM}`);
				if ((boost.fields.MaxBoostSpeed as number) !== 400) problems.push(`MaxBoostSpeed=${boost.fields.MaxBoostSpeed}`);
				if ((drift.fields.DriftMaxAngle as number) !== 75) problems.push(`DriftMaxAngle=${drift.fields.DriftMaxAngle}`);
				return problems;
			},
		},

		// ── zero-out scenarios ──
		{
			name: 'zero-all-grip',
			description: 'set all front/rear grip coefficients to zero',
			mutate: (m) => {
				const attrs = m.attributes.map(a => {
					if (a.className !== 'physicsvehiclebaseattribs') return a;
					const f = { ...a.fields };
					for (const key of Object.keys(f)) {
						if (key.includes('GripCurve') || key.includes('Friction') || key.includes('Adhesive')) {
							f[key] = 0;
						}
					}
					return { ...a, fields: f };
				});
				return { ...m, attributes: attrs };
			},
			verify: (_before, after) => {
				const base = after.attributes.find(a => a.className === 'physicsvehiclebaseattribs');
				if (!base) return ['missing physicsvehiclebaseattribs'];
				const problems: string[] = [];
				for (const [key, val] of Object.entries(base.fields)) {
					if ((key.includes('GripCurve') || key.includes('Friction') || key.includes('Adhesive')) && val !== 0) {
						problems.push(`${key}=${val}, expected 0`);
					}
				}
				return problems;
			},
		},
	],
};
