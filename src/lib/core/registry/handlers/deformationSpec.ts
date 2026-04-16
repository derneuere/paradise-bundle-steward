// DeformationSpec registry handler.
//
// Wraps src/lib/core/deformationSpec.ts. Read+write with full structural
// decoding: header, 4 wheels, 20 sensors, car→handling-body transform,
// counts + inertia block, tag points, driven points, generic/camera/light
// transform tags, IK parts with per-part joint specs, and glass panes.
//
// Every decoded field can be edited and the change round-trips byte-exactly
// (the writer patches fields onto the preserved raw buffer). Array-length
// edits are guarded — a layout normalizer to support add/remove isn't
// written yet.

import {
	parseDeformationSpecData,
	writeDeformationSpecData,
	DEFORMATION_SPEC_TYPE_ID,
	type ParsedDeformationSpec,
	type Vec4,
	type Mat4,
} from '../../deformationSpec';
import type { ResourceHandler } from '../handler';

/** Deep-clone a ParsedDeformationSpec. The stress runner hands us one but we
 *  re-clone at the top of each scenario so mutations stay isolated even
 *  when we call helpers that might alias sub-objects. */
function cloneDs(m: ParsedDeformationSpec): ParsedDeformationSpec {
	return JSON.parse(JSON.stringify(m)) as ParsedDeformationSpec;
}

export const deformationSpecHandler: ResourceHandler<ParsedDeformationSpec> = {
	typeId: DEFORMATION_SPEC_TYPE_ID,
	key: 'deformationSpec',
	name: 'Deformation Spec',
	description: 'Vehicle crash deformation: handling body, wheels, sensors, IK parts, tag points, glass panes',
	category: 'Data',
	caps: { read: true, write: true },

	parseRaw(raw, ctx) {
		return parseDeformationSpecData(raw, ctx.littleEndian);
	},
	writeRaw(model, ctx) {
		return writeDeformationSpecData(model, ctx.littleEndian);
	},
	describe(model) {
		const [hx, hy, hz] = model.handlingBodyDimensions;
		return `v${model.version}, body[${hx.toFixed(2)},${hy.toFixed(2)},${hz.toFixed(2)}], `
			+ `${model.wheels.length} wheels, ${model.sensors.length} sensors, `
			+ `tag=${model.tagPoints.length} driven=${model.drivenPoints.length} ik=${model.ikParts.length} `
			+ `glass=${model.glassPanes.length} gen=${model.genericTags.length} cam=${model.cameraTags.length} lit=${model.lightTags.length}`;
	},

	fixtures: [
		{ bundle: 'example/VEH_CARBRWDS_AT.BIN', expect: { parseOk: true, byteRoundTrip: true } },
	],

	stressScenarios: [
		{
			name: 'baseline',
			description: 'no mutation — exercises writer idempotence across every decoded region',
			mutate: (m) => m,
		},
		{
			name: 'scale-handling-body',
			description: 'scale mHandlingBodyDimensions by 1.1 — header-level f32 patch',
			mutate: (m) => {
				const c = cloneDs(m);
				c.handlingBodyDimensions = c.handlingBodyDimensions.map((v) => v * 1.1) as Vec4;
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < 4; i++) {
					if (Math.abs(re.handlingBodyDimensions[i] - mut.handlingBodyDimensions[i]) > 1e-3) {
						errs.push(`hbd[${i}] = ${re.handlingBodyDimensions[i]} != ${mut.handlingBodyDimensions[i]}`);
					}
				}
				return errs;
			},
		},
		{
			name: 'raise-all-wheels',
			description: 'add 0.1 to y of every wheel position — exercises WheelSpec Vec4 writer',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const w of c.wheels) w.position[1] += 0.1;
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < 4; i++) {
					if (Math.abs(re.wheels[i].position[1] - mut.wheels[i].position[1]) > 1e-3) {
						errs.push(`wheels[${i}].position.y drift`);
					}
				}
				return errs;
			},
		},
		{
			name: 'sensor-radii-x2',
			description: 'double every deformation-sensor radius — exercises 20-entry sensor table',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const s of c.sensors) s.radius *= 2;
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < mut.sensors.length; i++) {
					if (Math.abs(re.sensors[i].radius - mut.sensors[i].radius) > 1e-3) {
						errs.push(`sensors[${i}].radius drift`);
					}
				}
				return errs;
			},
		},
		{
			name: 'tag-point-initial-positions-zero',
			description: 'zero every tag point initial position — exercises pointer-resolved tag-point table (101 entries)',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const t of c.tagPoints) t.initialPosition = [0, 0, 0];
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < mut.tagPoints.length; i++) {
					const p = re.tagPoints[i].initialPosition;
					if (p[0] !== 0 || p[1] !== 0 || p[2] !== 0) {
						errs.push(`tagPoints[${i}].initialPosition = [${p}]`);
						if (errs.length >= 3) break;
					}
				}
				return errs;
			},
		},
		{
			name: 'driven-point-distance-sum',
			description: 'swap distanceFromA and distanceFromB on every driven point — exercises i16 + f32 patches',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const d of c.drivenPoints) {
					const tmp = d.distanceFromA;
					d.distanceFromA = d.distanceFromB;
					d.distanceFromB = tmp;
				}
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < mut.drivenPoints.length; i++) {
					if (Math.abs(re.drivenPoints[i].distanceFromA - mut.drivenPoints[i].distanceFromA) > 1e-3) {
						errs.push(`drivenPoints[${i}].distanceFromA drift`);
						break;
					}
				}
				return errs;
			},
		},
		{
			name: 'identity-car-to-handling-transform',
			description: 'replace mCarModelSpaceToHandlingBodySpace with identity — exercises Mat4 writer',
			mutate: (m) => {
				const c = cloneDs(m);
				const identity: Mat4 = [
					[1, 0, 0, 0],
					[0, 1, 0, 0],
					[0, 0, 1, 0],
					[0, 0, 0, 1],
				];
				c.carModelSpaceToHandlingBodySpace = identity;
				return c;
			},
			verify: (_mut, re) => {
				const errs: string[] = [];
				const m = re.carModelSpaceToHandlingBodySpace;
				if (m[0][0] !== 1 || m[1][1] !== 1 || m[2][2] !== 1 || m[3][3] !== 1) {
					errs.push(`diagonal not 1: ${m[0][0]},${m[1][1]},${m[2][2]},${m[3][3]}`);
				}
				if (m[0][1] !== 0 || m[1][0] !== 0 || m[2][3] !== 0) {
					errs.push(`off-diagonal not 0`);
				}
				return errs;
			},
		},
		{
			name: 'tweak-ikpart-joint-angles',
			description: 'bump maxJointAngle by 0.01 on every joint spec in every IK part',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const part of c.ikParts) {
					for (const j of part.jointSpecs) j.maxJointAngle += 0.01;
				}
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < mut.ikParts.length && errs.length < 3; i++) {
					const mp = mut.ikParts[i];
					const rp = re.ikParts[i];
					if (mp.jointSpecs.length !== rp.jointSpecs.length) {
						errs.push(`IKPart[${i}] joint count drift`);
						continue;
					}
					for (let j = 0; j < mp.jointSpecs.length && errs.length < 3; j++) {
						if (Math.abs(rp.jointSpecs[j].maxJointAngle - mp.jointSpecs[j].maxJointAngle) > 1e-3) {
							errs.push(`ik[${i}].joint[${j}].maxJointAngle drift`);
						}
					}
				}
				return errs;
			},
		},
		{
			name: 'shift-all-transform-tags',
			description: 'translate every generic/camera/light tag locator by +1 along x — exercises parallel tag tables',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const arr of [c.genericTags, c.cameraTags, c.lightTags]) {
					for (const t of arr) {
						// Translation row is row 3 in the on-disk row-major matrix.
						t.locator[3][0] += 1;
					}
				}
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				const check = (label: string, a: { locator: Mat4 }[], b: { locator: Mat4 }[]) => {
					for (let i = 0; i < a.length && errs.length < 3; i++) {
						if (Math.abs(b[i].locator[3][0] - a[i].locator[3][0]) > 1e-3) {
							errs.push(`${label}[${i}] translation.x drift`);
						}
					}
				};
				check('generic', mut.genericTags, re.genericTags);
				check('camera', mut.cameraTags, re.cameraTags);
				check('light', mut.lightTags, re.lightTags);
				return errs;
			},
		},
		{
			name: 'swap-glass-pane-corners',
			description: 'reverse cornerTagIndices on every glass pane — exercises i16 array patches',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const g of c.glassPanes) {
					g.cornerTagIndices = g.cornerTagIndices.slice().reverse() as typeof g.cornerTagIndices;
				}
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < mut.glassPanes.length && errs.length < 3; i++) {
					for (let k = 0; k < 4; k++) {
						if (re.glassPanes[i].cornerTagIndices[k] !== mut.glassPanes[i].cornerTagIndices[k]) {
							errs.push(`glass[${i}].cornerTagIndices[${k}] drift`);
						}
					}
				}
				return errs;
			},
		},
		{
			name: 'rebind-ikpart-skin',
			description: 'swap centerSkin and jointSkin on every IK part — exercises SkinBinding writer',
			mutate: (m) => {
				const c = cloneDs(m);
				for (const part of c.ikParts) {
					const tmp = part.centerSkin;
					part.centerSkin = part.jointSkin;
					part.jointSkin = tmp;
				}
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				for (let i = 0; i < mut.ikParts.length && errs.length < 3; i++) {
					if (re.ikParts[i].centerSkin.vertex[0] !== mut.ikParts[i].centerSkin.vertex[0]) {
						errs.push(`ik[${i}].centerSkin.vertex drift`);
					}
				}
				return errs;
			},
		},
		{
			name: 'append-tag-point',
			description: 'append a fresh tag point — exercises layout normalizer (downstream regions shift)',
			mutate: (m) => {
				const c = cloneDs(m);
				c.tagPoints.push({
					offsetFromA: [0, 0, 0], weightA: 1,
					offsetFromB: [0, 0, 0], weightB: 0,
					initialPosition: [0, 0, 0], detachThreshold: 100,
					fWeightA: 1, fWeightB: 0, fDetachThresholdSquared: 10000,
					deformationSensorA: 0, deformationSensorB: -1,
					jointIndex: -1, skinnedPoint: false,
				});
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				if (re.tagPoints.length !== mut.tagPoints.length) {
					errs.push(`tagPoints.length = ${re.tagPoints.length} != ${mut.tagPoints.length}`);
				}
				return errs;
			},
		},
		{
			name: 'pop-glass-pane',
			description: 'remove the last glass pane — exercises normalizer shrink path',
			mutate: (m) => {
				const c = cloneDs(m);
				c.glassPanes.pop();
				return c;
			},
			verify: (mut, re) => {
				const errs: string[] = [];
				if (re.glassPanes.length !== mut.glassPanes.length) {
					errs.push(`glassPanes.length = ${re.glassPanes.length} != ${mut.glassPanes.length}`);
				}
				return errs;
			},
		},
	],
};
