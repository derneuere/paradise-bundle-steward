// Headless deformation-spec overlay previewer.
//
// PURPOSE: let a text agent SEE whether a DeformationSpec's sensor / tag points
// actually sit on the car's real body. It decodes the vehicle body the same way
// the workspace viewport does (GraphicsSpec-driven, LOD0), renders it under a
// simple lambert rig, then OVERLAYS small emissive sphere markers at every
// deformation-sensor `initialOffset` (red) and every tag-point `initialPosition`
// (cyan), in the same body-local model space the meshes assemble in. If the spec
// is well-aligned the markers hug the bodywork; if a bundle is mis-rigged (e.g.
// a P12-positioned spec dropped onto an Alien body) the markers float off in
// empty space — which is exactly what this tool makes visible.
//
// Each GraphicsSpec part is tinted a distinct golden-angle HSL colour so the
// part breakdown stays legible without textures (textures are deliberately OFF
// here — this is a geometry/alignment check, not a paint check).
//
// Like render-car.ts this needs headless-gl built for the node-22 ABI and MUST
// run under node 22 (system node 16 can't load gl):
//
//   fnm exec --using=22 node node_modules/tsx/dist/cli.mjs scripts/preview-deform.ts \
//     --gr  D:/.../VEHICLES/VEH_ALIEN_GR.BIN \
//     --at  D:/.../VEHICLES/VEH_ALIEN_AT.BIN \
//     --tex D:/.../VEHICLES/VEHICLETEX.BIN \
//     --out /tmp/alien-deform --size 900x600

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import createGL from 'gl';
import * as THREE from 'three';
import { parseBundle } from '../src/lib/core/bundle/index';
import { parseDebugDataFromBuffer, parseDebugDataFromXml } from '../src/lib/core/bundle/debugData';
import type { TextureSourceBundle } from '../src/lib/core/materialChain';
import { decodeAllRenderables, locatorToMatrix4, type DecodedMesh } from '../src/lib/core/renderableDecode';
import { extractResourceRaw } from '../src/lib/core/registry/extract';
import { parseDeformationSpecData, DEFORMATION_SPEC_TYPE_ID, type Vec3 } from '../src/lib/core/deformationSpec';
import type { ParsedBundle } from '../src/lib/core/types';

// --- args -------------------------------------------------------------------
function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const GR = arg('gr')!;
const AT = arg('at')!;
const TEX = arg('tex')!;
const OUT = arg('out', '/tmp/deform')!;
const [W, H] = (arg('size', '900x600')!).split('x').map(Number);
if (!GR || !AT || !TEX) {
	throw new Error('usage: --gr <_GR.BIN> --at <_AT.BIN> --tex <VEHICLETEX.BIN> --out <dir> [--size WxH]');
}
mkdirSync(OUT, { recursive: true });

type Src = { bundle: ParsedBundle; arrayBuffer: ArrayBuffer; debug: ReturnType<typeof parseDebugDataFromXml> };
function load(path: string): Src {
	const buf = readFileSync(path);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const bundle = parseBundle(ab);
	let debug: ReturnType<typeof parseDebugDataFromXml> = [];
	try { const xml = parseDebugDataFromBuffer(ab, bundle.header); if (xml) debug = parseDebugDataFromXml(xml); } catch { /* */ }
	return { bundle, arrayBuffer: ab, debug };
}

// --- minimal RGBA → PNG (single IDAT, filter 0 per scanline) ----------------
function crc32(buf: Uint8Array): number {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
	return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}
function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
	const raw = new Uint8Array(h * (w * 4 + 1));
	for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
	const idat = deflateSync(Buffer.from(raw));
	const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat)), chunk('IEND', new Uint8Array(0))];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
	return out;
}

// --- colour helpers ---------------------------------------------------------
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	h = ((h % 360) + 360) % 360 / 360;
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hue = (t: number) => {
		if (t < 0) t += 1; if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}
const toHex = (c: [number, number, number]) =>
	'#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

// --- lambert + emissive ES1 shader -----------------------------------------
// uEmissive=1 flattens the lighting (markers glow at their own tint); uEmissive=0
// keeps the 0.55 ambient + diffuse lambert term so body shape stays readable.
const VS = `
precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vN;
void main(){ vN = mat3(uModel) * normal; gl_Position = uMVP * vec4(position, 1.0); }`;
const FS = `
precision highp float;
varying vec3 vN;
uniform vec3 uTint; uniform float uAlpha; uniform float uEmissive;
void main(){
	vec3 N = normalize(vN);
	vec3 L1 = normalize(vec3(0.5, 0.8, 0.4)), L2 = normalize(vec3(-0.6, 0.3, -0.7));
	float d = 0.55 + 0.7 * max(dot(N, L1), 0.0) + 0.3 * max(dot(N, L2), 0.0);
	float lit = mix(d, 1.0, uEmissive);
	gl_FragColor = vec4(uTint * lit, uAlpha);
}`;

function main() {
	// ---- Body decode (GraphicsSpec-driven, LOD0, textures resolved but unused) ----
	const primary = load(GR);
	const tex = load(TEX);
	const debugNames = new Map<string, string>();
	const norm = (s: string) => s.toLowerCase().replace(/^0x/, '').replace(/^0+(?=.)/, '');
	for (const d of primary.debug) if (d.id && d.name) debugNames.set(norm(d.id), d.name);
	const textureBundles: TextureSourceBundle[] = [{ buffer: tex.arrayBuffer, bundle: tex.bundle }];
	const decoded = decodeAllRenderables(primary.arrayBuffer, primary.bundle, debugNames, false, 'graphics', textureBundles, null);
	console.log(`decoded ${decoded.renderables.length} GraphicsSpec parts, ${decoded.totalMeshes} meshes, ${decoded.failed} failed`);

	// ---- DeformationSpec overlay points (parsed from the _AT bundle) ----
	const at = load(AT);
	const dsResource = at.bundle.resources.find((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID);
	if (!dsResource) throw new Error(`no DeformationSpec (0x${DEFORMATION_SPEC_TYPE_ID.toString(16)}) resource in ${AT}`);
	const dsRaw = extractResourceRaw(at.arrayBuffer, at.bundle, dsResource);
	const ds = parseDeformationSpecData(dsRaw, true);
	const sensorPts: Vec3[] = ds.sensors.map((s) => s.initialOffset);
	const tagPts: Vec3[] = ds.tagPoints.map((t) => t.initialPosition);
	console.log(`deformation spec: ${sensorPts.length} sensors, ${tagPts.length} tag points`);

	// ---- GL setup ----
	const gl = createGL(W, H, { preserveDrawingBuffer: true });
	gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.viewport(0, 0, W, H);
	const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'compile'); return o; };
	const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
	gl.useProgram(prog);
	const loc = (n: string) => gl.getUniformLocation(prog, n);
	const aPos = gl.getAttribLocation(prog, 'position'), aNrm = gl.getAttribLocation(prog, 'normal');
	const mkBuf = (data: ArrayBufferView, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };

	type Draw = { pos: WebGLBuffer; nrm: WebGLBuffer | null; idx: WebGLBuffer; n: number; tint: [number, number, number]; alpha: number; emissive: number; world: THREE.Matrix4 };
	const draws: Draw[] = [];
	// framing inputs: {center, radius} in world space over body meshes + markers
	const frames: { c: THREE.Vector3; r: number }[] = [];

	// ---- Body parts: golden-angle tint per GraphicsSpec part ----
	const legend: { idx: number; name: string; hex: string }[] = [];
	for (let i = 0; i < decoded.renderables.length; i++) {
		const r = decoded.renderables[i];
		const world = r.partLocator ? locatorToMatrix4(r.partLocator) : new THREE.Matrix4();
		const tint = hslToRgb(i * 137.508, 0.62, 0.55);
		legend.push({ idx: i, name: r.debugName ?? '(unnamed)', hex: toHex(tint) });
		for (const m of r.meshes) {
			const g = m.geometry;
			draws.push({
				pos: mkBuf(g.getAttribute('position').array as Float32Array),
				nrm: g.getAttribute('normal') ? mkBuf(g.getAttribute('normal').array as Float32Array) : null,
				idx: mkBuf(g.getIndex()!.array as Uint16Array, gl.ELEMENT_ARRAY_BUFFER),
				n: g.getIndex()!.count, tint, alpha: 1.0, emissive: 0, world,
			});
			g.computeBoundingSphere();
			const bs = g.boundingSphere!;
			frames.push({ c: bs.center.clone().applyMatrix4(world), r: bs.radius });
		}
	}

	// ---- Body AABB (world space) for the inside-body fraction ----
	// Built from each part's world-space bounding sphere extents (frames). This
	// is a loose box (sphere-padded), so "inside" means "within the body's gross
	// bounding volume" — good enough to flag markers that float clean off it.
	const bodyBox = new THREE.Box3();
	for (const f of frames) {
		bodyBox.expandByPoint(f.c.clone().subScalar(f.r));
		bodyBox.expandByPoint(f.c.clone().addScalar(f.r));
	}

	// ---- Marker geometry (one shared unit sphere, translated per point) ----
	const bodySize = bodyBox.getSize(new THREE.Vector3());
	const markerR = Math.max(bodySize.length() * 0.010, 0.02);
	const sphere = new THREE.SphereGeometry(markerR, 12, 8);
	const sPos = mkBuf(sphere.getAttribute('position').array as Float32Array);
	const sNrm = mkBuf(sphere.getAttribute('normal').array as Float32Array);
	const sIdxArr = new Uint16Array(sphere.getIndex()!.array as ArrayLike<number>);
	const sIdx = mkBuf(sIdxArr, gl.ELEMENT_ARRAY_BUFFER);
	const sN = sIdxArr.length;
	const RED: [number, number, number] = [0.95, 0.15, 0.15];
	const CYAN: [number, number, number] = [0.15, 0.85, 0.95];
	const addMarker = (p: Vec3, tint: [number, number, number]) => {
		const world = new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]);
		draws.push({ pos: sPos, nrm: sNrm, idx: sIdx, n: sN, tint, alpha: 1.0, emissive: 1.0, world });
		frames.push({ c: new THREE.Vector3(p[0], p[1], p[2]), r: markerR });
	};
	for (const p of sensorPts) addMarker(p, RED);
	for (const p of tagPts) addMarker(p, CYAN);

	// ---- Inside-body fraction ----
	const allMarkers = [...sensorPts, ...tagPts];
	let inside = 0;
	for (const p of allMarkers) if (bodyBox.containsPoint(new THREE.Vector3(p[0], p[1], p[2]))) inside++;
	const fracInside = allMarkers.length ? inside / allMarkers.length : 0;

	// ---- Robust framing: median-center, keep 90% nearest, box those ----
	const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	const mc = new THREE.Vector3(med(frames.map((i) => i.c.x)), med(frames.map((i) => i.c.y)), med(frames.map((i) => i.c.z)));
	const keep = frames.map((i) => ({ ...i, d: i.c.distanceTo(mc) })).sort((a, b) => a.d - b.d).slice(0, Math.max(1, Math.floor(frames.length * 0.9)));
	const worldBox = new THREE.Box3();
	for (const k of keep) { worldBox.expandByPoint(k.c.clone().subScalar(k.r)); worldBox.expandByPoint(k.c.clone().addScalar(k.r)); }
	const center = worldBox.getCenter(new THREE.Vector3());
	const radius = Math.max(worldBox.getSize(new THREE.Vector3()).length() * 0.5, 0.5);

	// ---- Render the four canonical angles ----
	const camera = new THREE.PerspectiveCamera(45, W / H, radius * 0.02, radius * 40);
	const mvp = new THREE.Matrix4(), vp = new THREE.Matrix4();
	const angles = [
		{ name: 'front34', az: 35, el: 16 }, { name: 'side', az: 90, el: 6 },
		{ name: 'rear34', az: 215, el: 16 }, { name: 'top', az: 40, el: 62 },
	];
	const px = new Uint8Array(W * H * 4), flip = new Uint8Array(W * H * 4);
	const pngPaths: string[] = [];
	for (const a of angles) {
		const az = (a.az * Math.PI) / 180, el = (a.el * Math.PI) / 180, dist = radius * 1.6;
		camera.position.set(center.x + dist * Math.cos(el) * Math.sin(az), center.y + dist * Math.sin(el), center.z + dist * Math.cos(el) * Math.cos(az));
		camera.up.set(0, 1, 0); camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
		vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		gl.clearColor(0.102, 0.114, 0.137, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		for (const d of draws) {
			mvp.multiplyMatrices(vp, d.world);
			gl.uniformMatrix4fv(loc('uMVP'), false, mvp.elements);
			gl.uniformMatrix4fv(loc('uModel'), false, d.world.elements);
			gl.uniform3f(loc('uTint'), d.tint[0], d.tint[1], d.tint[2]);
			gl.uniform1f(loc('uAlpha'), d.alpha);
			gl.uniform1f(loc('uEmissive'), d.emissive);
			gl.bindBuffer(gl.ARRAY_BUFFER, d.pos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
			if (d.nrm) { gl.bindBuffer(gl.ARRAY_BUFFER, d.nrm); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0); }
			else { gl.disableVertexAttribArray(aNrm); (gl.vertexAttrib4f as (i: number, x: number, y: number, z: number, w: number) => void)(aNrm, 0, 0, 1, 0); }
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.idx); gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_SHORT, 0);
		}
		gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
		for (let y = 0; y < H; y++) flip.set(px.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
		const file = `${OUT}/${a.name}.png`; writeFileSync(file, encodePng(flip, W, H));
		pngPaths.push(file);
		console.log(`wrote ${file}`);
	}

	// ---- Legend + summary ----
	console.log('\n--- part legend (idx -> debugName -> colour) ---');
	for (const l of legend) console.log(`  [${String(l.idx).padStart(2)}] ${l.hex}  ${l.name}`);
	console.log('\n--- overlay summary ---');
	console.log(`markers: ${allMarkers.length} total (${sensorPts.length} sensors red, ${tagPts.length} tag points cyan)`);
	console.log(`body AABB (world): min=(${bodyBox.min.x.toFixed(2)},${bodyBox.min.y.toFixed(2)},${bodyBox.min.z.toFixed(2)}) max=(${bodyBox.max.x.toFixed(2)},${bodyBox.max.y.toFixed(2)},${bodyBox.max.z.toFixed(2)})`);
	console.log(`markers inside body AABB: ${inside}/${allMarkers.length} = ${(fracInside * 100).toFixed(1)}%`);
	console.log('done');
}
main();
