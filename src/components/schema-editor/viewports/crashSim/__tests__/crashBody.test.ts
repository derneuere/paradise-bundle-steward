// A crash poses GraphicsSpec parts, so every decoded renderable must know
// which part it was drawn for: the Renderable view and the Crash Preview
// build the same body from the same decode.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { parseBundle } from '@/lib/core/bundle';
import { extractResourceRaw } from '@/lib/core/registry';
import { GRAPHICS_SPEC_TYPE_ID, parseGraphicsSpecData, resolveGraphicsSpecParts } from '@/lib/core/graphicsSpec';
import { decodeAllRenderables } from '@/lib/core/renderableDecode';
import { crashBodyFromDecoded, decodeCrashBody, hasGraphicsSpec } from '../crashBody';
import { isSkinned } from '../deformMaterial';

const FIXTURE = path.resolve(__dirname, '../../../../../../example/VEH_CARBRWDS_GR.BIN');
const file = fs.readFileSync(FIXTURE);
const buf = new Uint8Array(file.byteLength);
buf.set(file);
const buffer = buf.buffer;
const bundle = parseBundle(buffer);

describe('renderable -> GraphicsSpec part mapping', () => {
	const gsRes = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID)!;
	const parts = resolveGraphicsSpecParts(buffer, bundle, parseGraphicsSpecData(extractResourceRaw(buffer, bundle, gsRes)));
	const { renderables } = decodeAllRenderables(buffer, bundle, new Map(), false, 'graphics');

	it('tags every renderable decoded via the GraphicsSpec with its part index', () => {
		expect(renderables.length).toBeGreaterThan(10);
		for (const r of renderables) {
			expect(r.partIndex).toBeDefined();
			expect(parts[r.partIndex!].renderableId).toBe(r.resourceId);
			expect(r.partLocator).toEqual(parts[r.partIndex!].locator);
		}
	});

	it('leaves renderables decoded without the GraphicsSpec unposed', () => {
		const all = decodeAllRenderables(buffer, bundle, new Map(), false, 'all').renderables;
		expect(all.every((r) => r.partIndex === undefined)).toBe(true);
		expect(crashBodyFromDecoded(all).parts).toEqual([]);
	});

	it('groups meshes per part under the part locator, ordered by part', () => {
		const body = crashBodyFromDecoded(renderables);
		expect(body.parts.map((p) => p.gfx)).toEqual([...new Set(renderables.map((r) => r.partIndex))].sort((a, b) => a! - b!));
		for (const p of body.parts) {
			expect(p.locator.equals(new THREE.Matrix4().fromArray(Array.from(parts[p.gfx].locator)))).toBe(true);
			const meshes = renderables.filter((r) => r.partIndex === p.gfx).flatMap((r) => r.meshes.map((m) => m.geometry));
			expect(p.geometries).toEqual(meshes);
		}
	});

	it('reads the deformation rows the skinned meshes use', () => {
		const body = crashBodyFromDecoded(renderables);
		expect(body.parts.some((p) => p.geometries.some(isSkinned))).toBe(true);
		expect(body.skinRows).toBeGreaterThan(0);
		expect(body.skinRows).toBeLessThanOrEqual(128);
		expect(body.box.isEmpty()).toBe(false);
	});

	it('decodes the same body the Crash Preview draws', () => {
		expect(hasGraphicsSpec(bundle)).toBe(true);
		const a = decodeCrashBody(bundle, buffer);
		const b = crashBodyFromDecoded(renderables);
		expect(a.parts.map((p) => p.gfx)).toEqual(b.parts.map((p) => p.gfx));
		expect(a.skinRows).toBe(b.skinRows);
		expect(a.box.equals(b.box)).toBe(true);
	});
});
