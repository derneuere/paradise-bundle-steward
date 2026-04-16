// Inline 3D preview for a Matrix44Affine's rotation + scale. Renders a box
// (the same dimensions used by TrafficDataViewport for static vehicles) at
// origin with the stored rotation applied, so the orientation mirrors the
// main-scene vehicle one-for-one.
//
// Interaction: left-click drag anywhere on the canvas trackball-rotates
// the box (Shoemake arcball). Scale and translation are preserved; only
// m[0..11]'s rotation basis changes on drag. The camera is fixed — no
// orbit controls — so the drag is unambiguously manipulating the object.

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helpers — matrix ↔ storage conversion
// ---------------------------------------------------------------------------

// Build a THREE.Matrix4 from 16 row-major storage elements, zeroing the
// translation row so the preview box always renders at origin. Uses the
// same argument order as TrafficDataViewport's AllStaticVehicleInstances
// so the visible orientation matches the main-scene vehicle.
function buildDisplayMatrix(m: number[]): THREE.Matrix4 {
	const mat = new THREE.Matrix4();
	mat.set(
		m[0] ?? 1, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0,
		m[4] ?? 0, m[5] ?? 1, m[6] ?? 0, m[7] ?? 0,
		m[8] ?? 0, m[9] ?? 0, m[10] ?? 1, m[11] ?? 0,
		0, 0, 0, 1,
	);
	return mat;
}

// Read back the 16 storage values from a THREE.Matrix4 that was built via
// `.set(S[0..15])`. Because THREE stores column-major but `.set()` takes
// row-major input, storage order = transpose(elements).
function readStorageFromMatrix(mat: THREE.Matrix4): number[] {
	const e = mat.elements; // column-major
	return [
		e[0], e[4], e[8],  e[12],
		e[1], e[5], e[9],  e[13],
		e[2], e[6], e[10], e[14],
		e[3], e[7], e[11], e[15],
	];
}

// ---------------------------------------------------------------------------
// Shoemake arcball projection
// ---------------------------------------------------------------------------

// Map a canvas-local (x, y) in pixels to a point on the unit sphere. If
// the cursor is outside the sphere's radius, snap to the sphere boundary
// (z=0). Radius is half the min canvas dimension, so the sphere fills the
// shorter axis of the drawing area.
function projectToSphere(x: number, y: number, rect: DOMRect): THREE.Vector3 {
	const cx = rect.width / 2;
	const cy = rect.height / 2;
	const r = Math.min(cx, cy);
	// nx, ny in unit-sphere coords — y flipped because browser Y points down.
	const nx = (x - cx) / r;
	const ny = -(y - cy) / r;
	const d2 = nx * nx + ny * ny;
	if (d2 <= 1) {
		return new THREE.Vector3(nx, ny, Math.sqrt(1 - d2));
	}
	const d = Math.sqrt(d2);
	return new THREE.Vector3(nx / d, ny / d, 0);
}

// ---------------------------------------------------------------------------
// Inner R3F pieces
// ---------------------------------------------------------------------------

// Tiny helper component: lives inside the Canvas so it can call useThree,
// and pushes the active camera up to the outer component's ref. Renders
// nothing.
function CameraStash({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
	const { camera } = useThree();
	useEffect(() => { cameraRef.current = camera; }, [camera, cameraRef]);
	return null;
}

function PreviewBox({ matrix }: { matrix: number[] }) {
	const meshRef = useRef<THREE.Mesh>(null!);
	const edgesRef = useRef<THREE.LineSegments>(null!);

	const boxGeo = useMemo(() => new THREE.BoxGeometry(3, 2, 5), []);
	const edgesGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);

	useEffect(() => {
		const mat = buildDisplayMatrix(matrix);
		if (meshRef.current) {
			meshRef.current.matrixAutoUpdate = false;
			meshRef.current.matrix.copy(mat);
		}
		if (edgesRef.current) {
			edgesRef.current.matrixAutoUpdate = false;
			edgesRef.current.matrix.copy(mat);
		}
	}, [matrix]);

	return (
		<>
			<mesh ref={meshRef} geometry={boxGeo}>
				<meshStandardMaterial color={0xcc6633} roughness={0.6} metalness={0.1} />
			</mesh>
			<lineSegments ref={edgesRef} geometry={edgesGeo}>
				<lineBasicMaterial color={0x000000} />
			</lineSegments>
		</>
	);
}

// Axis helper — short coloured lines along ±X (red), ±Y (green), ±Z (blue).
function Axes() {
	const geo = useMemo(() => {
		const g = new THREE.BufferGeometry();
		const L = 4;
		const positions = new Float32Array([
			-L, 0, 0,  L, 0, 0,
			0, -L, 0,  0, L, 0,
			0, 0, -L,  0, 0, L,
		]);
		const colors = new Float32Array([
			0.9, 0.3, 0.3,   0.9, 0.3, 0.3,
			0.3, 0.9, 0.3,   0.3, 0.9, 0.3,
			0.35, 0.55, 0.95, 0.35, 0.55, 0.95,
		]);
		g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		return g;
	}, []);
	const mat = useMemo(() => new THREE.LineBasicMaterial({
		vertexColors: true, transparent: true, opacity: 0.45,
	}), []);
	return <lineSegments geometry={geo} material={mat} />;
}

// ---------------------------------------------------------------------------
// Outer component — owns pointer handlers and the drag state machine
// ---------------------------------------------------------------------------

type Props = {
	/** Full 16-element row-major matrix (storage order). */
	matrix: number[];
	/** Called with a new 16-element matrix on drag. Only m[0..11] change. */
	onChange: (next: number[]) => void;
	/** When true, drag is disabled. */
	readOnly?: boolean;
};

type DragSnapshot = {
	pointerId: number;
	rect: DOMRect;
	v0: THREE.Vector3;
	// Snapshot of the matrix at drag start — the delta is always applied
	// to this, not the live value, so interpolation stays smooth.
	startMatrix: number[];
	// Per-row scale lengths extracted from startMatrix[0..11].
	scale: [number, number, number];
	// Unit rotation rows (3×3) extracted from startMatrix[0..11] / scale.
	startRotRows: [
		[number, number, number],
		[number, number, number],
		[number, number, number],
	];
	// Camera rotation as a 3×3, used to push axis vectors from camera
	// space to world space.
	camToWorld: THREE.Matrix3;
};

export function RotationVisualizer({ matrix, onChange, readOnly }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<DragSnapshot | null>(null);
	const cameraRef = useRef<THREE.Camera | null>(null);

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (readOnly) return;
		if (e.button !== 0) return; // left click only
		const el = containerRef.current;
		const cam = cameraRef.current;
		if (!el || !cam) return;

		const rect = el.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const v0 = projectToSphere(x, y, rect);

		// Extract per-row scale + unit rotation from storage.
		const m = matrix;
		const sx = Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0) || 1;
		const sy = Math.hypot(m[4] ?? 0, m[5] ?? 0, m[6] ?? 0) || 1;
		const sz = Math.hypot(m[8] ?? 0, m[9] ?? 0, m[10] ?? 0) || 1;
		const startRotRows: DragSnapshot['startRotRows'] = [
			[(m[0] ?? 0) / sx, (m[1] ?? 0) / sx, (m[2] ?? 0) / sx],
			[(m[4] ?? 0) / sy, (m[5] ?? 0) / sy, (m[6] ?? 0) / sy],
			[(m[8] ?? 0) / sz, (m[9] ?? 0) / sz, (m[10] ?? 0) / sz],
		];

		// Camera world matrix → its 3×3 rotation part transforms vectors
		// from camera space into world space.
		const camToWorld = new THREE.Matrix3().setFromMatrix4(cam.matrixWorld);

		dragRef.current = {
			pointerId: e.pointerId,
			rect,
			v0,
			startMatrix: matrix.slice(),
			scale: [sx, sy, sz],
			startRotRows,
			camToWorld,
		};

		el.setPointerCapture(e.pointerId);
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const snap = dragRef.current;
		if (!snap || e.pointerId !== snap.pointerId) return;
		const x = e.clientX - snap.rect.left;
		const y = e.clientY - snap.rect.top;
		const v = projectToSphere(x, y, snap.rect);

		// Axis + angle in camera space from the arcball.
		const axisCam = new THREE.Vector3().crossVectors(snap.v0, v);
		const axisLen = axisCam.length();
		if (axisLen < 1e-6) return; // no movement
		const angle = Math.atan2(axisLen, snap.v0.dot(v));
		const axisWorld = axisCam.clone().divideScalar(axisLen).applyMatrix3(snap.camToWorld);

		const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisWorld, angle);

		// Reconstruct the start rotation as a THREE.Matrix4 using the same
		// row-major .set() convention as buildDisplayMatrix, decompose to
		// get the start quaternion, apply the delta, recompose, and push
		// back to storage form (transpose of elements).
		const startMat = new THREE.Matrix4();
		const r = snap.startRotRows;
		startMat.set(
			r[0][0], r[0][1], r[0][2], 0,
			r[1][0], r[1][1], r[1][2], 0,
			r[2][0], r[2][1], r[2][2], 0,
			0, 0, 0, 1,
		);
		const startQuat = new THREE.Quaternion().setFromRotationMatrix(startMat);
		const newQuat = deltaQ.clone().multiply(startQuat);

		// Compose a pure-rotation matrix from newQuat, read back as
		// row-major storage rows (transpose of elements), then apply per-row
		// scale and stitch with the original translation row.
		const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(newQuat);
		const rowForm = readStorageFromMatrix(rotMat);
		const [sx, sy, sz] = snap.scale;

		const out = snap.startMatrix.slice();
		out[0] = rowForm[0] * sx; out[1] = rowForm[1] * sx; out[2] = rowForm[2] * sx; out[3] = 0;
		out[4] = rowForm[4] * sy; out[5] = rowForm[5] * sy; out[6] = rowForm[6] * sy; out[7] = 0;
		out[8] = rowForm[8] * sz; out[9] = rowForm[9] * sz; out[10] = rowForm[10] * sz; out[11] = 0;
		// out[12..15] preserved from startMatrix.
		onChange(out);
	};

	const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
		const snap = dragRef.current;
		if (!snap || e.pointerId !== snap.pointerId) return;
		dragRef.current = null;
		containerRef.current?.releasePointerCapture(e.pointerId);
	};

	return (
		<div
			ref={containerRef}
			className={`h-40 rounded overflow-hidden border border-input ${readOnly ? '' : 'cursor-grab active:cursor-grabbing'}`}
			style={{ touchAction: 'none', background: '#1a1d23' }}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
		>
			<Canvas
				camera={{ position: [6, 4, 8], fov: 45, near: 0.1, far: 100 }}
				gl={{ antialias: true }}
			>
				<color attach="background" args={['#1a1d23']} />
				<ambientLight intensity={0.55} />
				<directionalLight position={[5, 10, 5]} intensity={0.8} />
				<CameraStash cameraRef={cameraRef} />
				<Axes />
				<PreviewBox matrix={matrix} />
			</Canvas>
		</div>
	);
}
