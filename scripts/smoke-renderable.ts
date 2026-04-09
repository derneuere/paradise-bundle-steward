// End-to-end smoke test for src/lib/core/renderable.ts.
//
// Loads example/VEH_CARBRWDS_GR.BIN, finds the first Renderable, parses it,
// resolves its imported VertexDescriptors, decodes positions for the
// preferred VD slot, and prints a summary that should match the numbers we
// captured in docs/Renderable_findings.md (1806 indices, 1436 verts at
// stride 52, etc).
//
// Run: eval "$(fnm env --shell=bash)" && fnm use 22 && npx tsx scripts/smoke-renderable.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../src/lib/core/bundle';
import {
	RENDERABLE_TYPE_ID,
	VERTEX_DESCRIPTOR_TYPE_ID,
	getRenderableBlocks,
	readInlineImportTable,
	parseRenderable,
	parseVertexDescriptor,
	pickPrimaryVertexDescriptor,
	decodeVertexArrays,
	meshIndicesU16,
	findResourceById,
	describeRenderable,
	type ParsedVertexDescriptor,
} from '../src/lib/core/renderable';
import { extractResourceSize, isCompressed, decompressData } from '../src/lib/core/resourceManager';

function main() {
	const bundlePath = process.argv[2] ?? 'example/VEH_CARBRWDS_GR.BIN';
	const abs = path.resolve(bundlePath);
	const fileBuf = fs.readFileSync(abs);
	const buffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
	const bundle = parseBundle(buffer);
	console.log(`bundle: ${abs}`);
	console.log(`  resources: ${bundle.resources.length}`);

	// Find the first Renderable that has a body block
	const renderables = bundle.resources.filter((r) => r.resourceTypeId === RENDERABLE_TYPE_ID);
	console.log(`  Renderables: ${renderables.length}`);
	const target = renderables.find((r) => extractResourceSize(r.sizeAndAlignmentOnDisk[1]) > 0);
	if (!target) {
		console.error('No Renderable with a body block found');
		process.exit(1);
	}

	const { header, body } = getRenderableBlocks(buffer, bundle, target);
	if (!body) {
		console.error('Renderable has no body block (despite size > 0)');
		process.exit(1);
	}
	console.log(`  picked id ${target.resourceId.high.toString(16).padStart(8, '0')}${target.resourceId.low.toString(16).padStart(8, '0')}`);
	console.log(`  header: ${header.byteLength} bytes`);
	console.log(`  body:   ${body.byteLength} bytes`);

	const imports = readInlineImportTable(header, target);
	console.log(`  imports: ${imports.size} entries`);

	const renderable = parseRenderable(header, imports);
	console.log(`\n  ${describeRenderable(renderable)}`);

	// Per-mesh dump
	console.log('\n  meshes:');
	let totalIdx = 0;
	for (let i = 0; i < renderable.meshes.length; i++) {
		const m = renderable.meshes[i];
		const matStr = m.materialAssemblyId !== null ? `0x${m.materialAssemblyId.toString(16)}` : 'null';
		const vdCount = m.vertexDescriptorIds.filter((x) => x !== null).length;
		console.log(`    [${i}] primType=${m.primitiveType} startIdx=${m.startIndex} numIdx=${m.numIndices} numVDs=${m.numVertexDescriptors}/${vdCount} mat=${matStr}`);
		totalIdx += m.numIndices;
	}
	console.log(`  total indices summed: ${totalIdx}`);

	// Resolve VertexDescriptors. We need a function that takes an id and gives
	// us back parsed VD bytes — this is the part that lives in the React handler
	// in real code, but here we inline it.
	const vdCache = new Map<bigint, ParsedVertexDescriptor>();
	const resolver = (id: bigint): ParsedVertexDescriptor | null => {
		const cached = vdCache.get(id);
		if (cached) return cached;
		const entry = findResourceById(bundle, id);
		if (!entry) return null;
		if (entry.resourceTypeId !== VERTEX_DESCRIPTOR_TYPE_ID) return null;
		// Inline a 1-block extractor since the VD is just one block of bytes.
		const size = extractResourceSize(entry.sizeAndAlignmentOnDisk[0]);
		if (size <= 0) return null;
		const start = (bundle.header.resourceDataOffsets[0] + entry.diskOffsets[0]) >>> 0;
		let bytes = new Uint8Array(buffer, start, size);
		if (isCompressed(bytes)) bytes = decompressData(bytes);
		const parsed = parseVertexDescriptor(bytes);
		vdCache.set(id, parsed);
		return parsed;
	};

	console.log('\n  vertex decode (mesh[0]):');
	const m0 = renderable.meshes[0];
	const picked = pickPrimaryVertexDescriptor(m0, resolver);
	if (!picked) {
		console.error('  could not pick a primary VD for mesh[0]');
		process.exit(1);
	}
	console.log(`    primary VD slot=${picked.slot} attrs=${picked.descriptor.attributes.length} stride=${picked.descriptor.stride}`);
	for (const a of picked.descriptor.attributes) {
		console.log(`      type=${a.type} offset=${a.offset} stride=${a.stride}`);
	}

	const verts = decodeVertexArrays(body, renderable.vertexBuffer, picked.descriptor);
	console.log(`    decoded ${verts.vertexCount} verts; positions[0..2] = (${verts.positions[0].toFixed(3)}, ${verts.positions[1].toFixed(3)}, ${verts.positions[2].toFixed(3)})`);
	if (verts.normals) {
		console.log(`    normals[0..2] = (${verts.normals[0].toFixed(3)}, ${verts.normals[1].toFixed(3)}, ${verts.normals[2].toFixed(3)})`);
	}
	if (verts.uv1) {
		console.log(`    uv1[0..1] = (${verts.uv1[0].toFixed(3)}, ${verts.uv1[1].toFixed(3)})`);
	}

	const idx = meshIndicesU16(body, renderable.indexBuffer, m0);
	let maxIdx = -1;
	for (let i = 0; i < idx.length; i++) if (idx[i] > maxIdx) maxIdx = idx[i];
	console.log(`    mesh[0] indices: ${idx.length} u16, range [${idx[0]} .. ${maxIdx}]`);
	console.log(`    first 12 indices: [${Array.from(idx.slice(0, 12)).join(', ')}]`);

	// Sanity: max index across all meshes should match decoded vertex count - 1
	let globalMax = -1;
	const referenced = new Set<number>();
	for (const mesh of renderable.meshes) {
		const meshIdx = meshIndicesU16(body, renderable.indexBuffer, mesh);
		for (let i = 0; i < meshIdx.length; i++) {
			const v = meshIdx[i];
			referenced.add(v);
			if (v > globalMax) globalMax = v;
		}
	}
	console.log(`\n  global max index across all meshes: ${globalMax}`);
	console.log(`  unique referenced verts:             ${referenced.size}`);
	console.log(`  decoded vertex count:                ${verts.vertexCount}`);
	if (globalMax + 1 !== verts.vertexCount) {
		console.error(`  [!] MISMATCH: max index + 1 (${globalMax + 1}) != vertexCount (${verts.vertexCount})`);
		process.exit(2);
	}
	console.log(`  ✓ max index + 1 == vertex count`);

	// Quick bounding-box check on positions. ALL decoded vertices first, then
	// only those actually referenced by mesh[0]'s indices (typically a much
	// smaller subset). If mesh[0]'s subset is in range but the global bbox
	// isn't, the buffer either has junk-padding verts at extreme positions or
	// the stride/offset is off.
	const bboxOver = (vertIdxs: number[]) => {
		let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		for (const v of vertIdxs) {
			const x = verts.positions[v * 3 + 0];
			const y = verts.positions[v * 3 + 1];
			const z = verts.positions[v * 3 + 2];
			if (x < minX) minX = x; if (x > maxX) maxX = x;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
			if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
		}
		return { minX, minY, minZ, maxX, maxY, maxZ };
	};
	const allIdxs = Array.from({ length: verts.vertexCount }, (_, i) => i);
	const all = bboxOver(allIdxs);
	console.log(`\n  bbox over all ${verts.vertexCount} decoded verts: x[${all.minX.toFixed(3)}..${all.maxX.toFixed(3)}] y[${all.minY.toFixed(3)}..${all.maxY.toFixed(3)}] z[${all.minZ.toFixed(3)}..${all.maxZ.toFixed(3)}]`);

	const usedByMesh0 = new Set<number>();
	for (let i = 0; i < idx.length; i++) usedByMesh0.add(idx[i]);
	const m0bb = bboxOver([...usedByMesh0]);
	console.log(`  bbox over mesh[0] referenced verts (${usedByMesh0.size}): x[${m0bb.minX.toFixed(3)}..${m0bb.maxX.toFixed(3)}] y[${m0bb.minY.toFixed(3)}..${m0bb.maxY.toFixed(3)}] z[${m0bb.minZ.toFixed(3)}..${m0bb.maxZ.toFixed(3)}]`);

	const bs = renderable.header.boundingSphere;
	console.log(`  Renderable.boundingSphere center=(${bs[0].toFixed(3)}, ${bs[1].toFixed(3)}, ${bs[2].toFixed(3)}) radius=${bs[3].toFixed(3)}`);

	// If the global bbox is way bigger than mesh[0]'s, log which vertex indices
	// are extreme so we can eyeball them.
	let furthestFromOrigin = 0;
	let furthestIdx = -1;
	for (let v = 0; v < verts.vertexCount; v++) {
		const x = verts.positions[v * 3 + 0];
		const y = verts.positions[v * 3 + 1];
		const z = verts.positions[v * 3 + 2];
		const r = Math.hypot(x, y, z);
		if (r > furthestFromOrigin) { furthestFromOrigin = r; furthestIdx = v; }
	}
	if (furthestIdx >= 0) {
		const x = verts.positions[furthestIdx * 3 + 0];
		const y = verts.positions[furthestIdx * 3 + 1];
		const z = verts.positions[furthestIdx * 3 + 2];
		const isRef = referenced.has(furthestIdx);
		console.log(`  furthest vert from origin: idx=${furthestIdx} pos=(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) dist=${furthestFromOrigin.toFixed(3)} referenced=${isRef}`);
	}

	// bbox restricted to ACTUALLY-REFERENCED vertices
	const refBb = bboxOver([...referenced]);
	console.log(`  bbox over referenced verts (${referenced.size}/${verts.vertexCount}): x[${refBb.minX.toFixed(3)}..${refBb.maxX.toFixed(3)}] y[${refBb.minY.toFixed(3)}..${refBb.maxY.toFixed(3)}] z[${refBb.minZ.toFixed(3)}..${refBb.maxZ.toFixed(3)}]`);

	console.log('\n  ✓ smoke test passed');
}

main();
