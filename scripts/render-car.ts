// Headless multi-angle renderer for a decoded vehicle.
//
// Renders the SAME decode the workspace viewport produces — GraphicsSpec-driven,
// LOD0, with cross-bundle material/texture resolution — to PNG files from
// several camera angles, so geometry + texture-binding changes can be eyeballed
// without the browser.
//
// SCOPE: this renders each mesh with its resolved DIFFUSE texture under a simple
// lambert light rig. It deliberately does NOT run the DXBC-translated
// ShaderMaterials: those emit GLSL ES 3.0 (mix-with-bvec selectors, etc.) and
// need a WebGL2 context, which headless-gl (`gl`, WebGL1/ES1 only) can't give.
// For the full translated-shader look (reflections, paint, glass) use the
// browser preview. What this DOES prove headlessly: geometry assembles, part
// locators place renderables correctly, and the per-mesh diffuse textures
// resolve across the loaded companion bundles (no missing-texture magenta).
//
// Needs headless-gl built for the node 22 ABI:
//   <node22>/npm rebuild gl --build-from-source   (MSVC + Python)
//
// Run: fnm exec --using=22 node node_modules/tsx/dist/cli.mjs \
//        scripts/render-car.ts --gr example/VEH_CARBB1GT_GR.BIN \
//        --tex example/VEHICLETEX.BIN --shaders example/SHADERS.BNDL \
//        --out /tmp/car --size 900x600

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import createGL from 'gl';
import * as THREE from 'three';
import { parseBundle } from '../src/lib/core/bundle/index';
import { parseDebugDataFromBuffer, parseDebugDataFromXml } from '../src/lib/core/bundle/debugData';
import { parseShaderNameMap, type TextureSourceBundle } from '../src/lib/core/materialChain';
import { decodeAllRenderables, locatorToMatrix4, type DecodedMesh } from '../src/lib/core/renderableDecode';
import { u64ToBigInt } from '../src/lib/core/u64';
import type { ParsedBundle } from '../src/lib/core/types';

// --- args -------------------------------------------------------------------
function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const GR = arg('gr', 'example/VEH_CARBB1GT_GR.BIN')!;
const TEX = arg('tex', 'example/VEHICLETEX.BIN')!;
const SHADERS = arg('shaders', 'example/SHADERS.BNDL')!;
const OUT = arg('out', '/tmp/car')!;
const [W, H] = (arg('size', '900x600')!).split('x').map(Number);
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

// --- lambert ES1 shader -----------------------------------------------------
const VS = `
precision highp float;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vN; varying vec2 vUv;
void main(){ vN = mat3(uModel) * normal; vUv = uv; gl_Position = uMVP * vec4(position, 1.0); }`;
const FS = `
precision highp float;
varying vec3 vN; varying vec2 vUv;
uniform sampler2D uTex; uniform float uHasTex; uniform vec3 uTint; uniform float uAlpha;
void main(){
	vec3 N = normalize(vN);
	vec3 L1 = normalize(vec3(0.5, 0.8, 0.4)), L2 = normalize(vec3(-0.6, 0.3, -0.7));
	float d = 0.55 + 0.7 * max(dot(N, L1), 0.0) + 0.3 * max(dot(N, L2), 0.0);
	vec3 base = mix(uTint, texture2D(uTex, vUv).rgb, uHasTex);
	gl_FragColor = vec4(base * d, uAlpha);
}`;

function main() {
	const primary = load(GR);
	const tex = load(TEX);
	const shaders = load(SHADERS);
	const shaderNameMap = parseShaderNameMap(shaders.arrayBuffer);
	const debugNames = new Map<string, string>();
	const norm = (s: string) => s.toLowerCase().replace(/^0x/, '').replace(/^0+(?=.)/, '');
	for (const d of primary.debug) if (d.id && d.name) debugNames.set(norm(d.id), d.name);
	const textureBundles: TextureSourceBundle[] = [
		{ buffer: tex.arrayBuffer, bundle: tex.bundle },
		{ buffer: shaders.arrayBuffer, bundle: shaders.bundle },
	];
	const decoded = decodeAllRenderables(primary.arrayBuffer, primary.bundle, debugNames, false, 'graphics', textureBundles, shaderNameMap);
	console.log(`decoded ${decoded.renderables.length} renderables, ${decoded.totalMeshes} meshes, ${decoded.failed} failed`);

	const gl = createGL(W, H, { preserveDrawingBuffer: true });
	gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.viewport(0, 0, W, H);
	const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'compile'); return o; };
	const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
	gl.useProgram(prog);
	const loc = (n: string) => gl.getUniformLocation(prog, n);
	const aPos = gl.getAttribLocation(prog, 'position'), aNrm = gl.getAttribLocation(prog, 'normal'), aUv = gl.getAttribLocation(prog, 'uv');

	const white = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

	type Draw = { pos: WebGLBuffer; nrm: WebGLBuffer | null; uv: WebGLBuffer | null; idx: WebGLBuffer; n: number; tex: WebGLTexture | null; tint: [number, number, number]; alpha: number; world: THREE.Matrix4 };
	const draws: Draw[] = [];
	const centers: { c: THREE.Vector3; r: number }[] = [];
	const mkBuf = (data: ArrayBufferView, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
	const mkTex = (m: DecodedMesh): WebGLTexture | null => {
		const dt = m.resolvedMaterial?.diffuse; if (!dt) return null;
		const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, dt.header.width, dt.header.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, dt.pixels);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return t;
	};
	let textured = 0;
	for (const r of decoded.renderables) {
		const world = r.partLocator ? locatorToMatrix4(r.partLocator) : new THREE.Matrix4();
		for (const m of r.meshes) {
			const g = m.geometry;
			const t = mkTex(m); if (t) textured++;
			const sn = m.resolvedMaterial?.shaderName ?? '';
			const isGlass = /window|glass/i.test(sn);
			draws.push({
				pos: mkBuf(g.getAttribute('position').array as Float32Array),
				nrm: g.getAttribute('normal') ? mkBuf(g.getAttribute('normal').array as Float32Array) : null,
				uv: g.getAttribute('uv') ? mkBuf(g.getAttribute('uv').array as Float32Array) : null,
				idx: mkBuf(g.getIndex()!.array as Uint16Array, gl.ELEMENT_ARRAY_BUFFER),
				n: g.getIndex()!.count, tex: t,
				tint: isGlass ? [0.3, 0.4, 0.5] : [0.62, 0.64, 0.68], alpha: isGlass ? 0.55 : 1.0,
				world,
			});
			g.computeBoundingSphere();
			const bs = g.boundingSphere!;
			centers.push({ c: bs.center.clone().applyMatrix4(world), r: bs.radius });
		}
	}
	// Robust framing: median-center, keep the 90% nearest meshes, box those.
	// Mirrors computeSceneBounds — a single far-flung part (stray locator) must
	// not balloon the radius and shrink the car to a speck.
	const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	const mc = new THREE.Vector3(med(centers.map((i) => i.c.x)), med(centers.map((i) => i.c.y)), med(centers.map((i) => i.c.z)));
	const keep = centers.map((i) => ({ ...i, d: i.c.distanceTo(mc) })).sort((a, b) => a.d - b.d).slice(0, Math.max(1, Math.floor(centers.length * 0.9)));
	const worldBox = new THREE.Box3();
	for (const k of keep) { worldBox.expandByPoint(k.c.clone().subScalar(k.r)); worldBox.expandByPoint(k.c.clone().addScalar(k.r)); }
	const center = worldBox.getCenter(new THREE.Vector3());
	const radius = Math.max(worldBox.getSize(new THREE.Vector3()).length() * 0.5, 0.5);
	console.log(`drawables=${draws.length} (textured=${textured}) bounds center=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}) radius=${radius.toFixed(2)}`);

	const camera = new THREE.PerspectiveCamera(45, W / H, radius * 0.02, radius * 40);
	const mvp = new THREE.Matrix4(), vp = new THREE.Matrix4();
	const angles = [
		{ name: 'front34', az: 35, el: 16 }, { name: 'side', az: 90, el: 6 },
		{ name: 'rear34', az: 215, el: 16 }, { name: 'top', az: 40, el: 62 },
	];
	const px = new Uint8Array(W * H * 4), flip = new Uint8Array(W * H * 4);
	for (const a of angles) {
		const az = (a.az * Math.PI) / 180, el = (a.el * Math.PI) / 180, dist = radius * 1.45;
		camera.position.set(center.x + dist * Math.cos(el) * Math.sin(az), center.y + dist * Math.sin(el), center.z + dist * Math.cos(el) * Math.cos(az));
		camera.up.set(0, 1, 0); camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
		vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		gl.clearColor(0.102, 0.114, 0.137, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		for (const d of draws) {
			mvp.multiplyMatrices(vp, d.world);
			gl.uniformMatrix4fv(loc('uMVP'), false, mvp.elements);
			gl.uniformMatrix4fv(loc('uModel'), false, d.world.elements);
			gl.uniform1f(loc('uHasTex'), d.tex ? 1 : 0);
			gl.uniform3f(loc('uTint'), d.tint[0], d.tint[1], d.tint[2]);
			gl.uniform1f(loc('uAlpha'), d.alpha);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, d.tex ?? white); gl.uniform1i(loc('uTex'), 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, d.pos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
			if (d.nrm) { gl.bindBuffer(gl.ARRAY_BUFFER, d.nrm); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0); }
			else { gl.disableVertexAttribArray(aNrm); (gl.vertexAttrib4f as (i: number, x: number, y: number, z: number, w: number) => void)(aNrm, 0, 0, 1, 0); }
			if (aUv >= 0) { if (d.uv) { gl.bindBuffer(gl.ARRAY_BUFFER, d.uv); gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0); } else { gl.disableVertexAttribArray(aUv); (gl.vertexAttrib4f as (i: number, x: number, y: number, z: number, w: number) => void)(aUv, 0, 0, 0, 0); } }
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.idx); gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_SHORT, 0);
		}
		gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
		for (let y = 0; y < H; y++) flip.set(px.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
		const file = `${OUT}/${a.name}.png`; writeFileSync(file, encodePng(flip, W, H));
		let nonbg = 0; for (let i = 0; i < px.length; i += 4) if (!(Math.abs(px[i] - 26) < 7 && Math.abs(px[i + 1] - 29) < 7 && Math.abs(px[i + 2] - 35) < 7)) nonbg++;
		console.log(`wrote ${file}  car≈${((nonbg / (W * H)) * 100).toFixed(1)}% of frame`);
	}
	console.log('done');
}
main();
