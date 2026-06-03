// Pointer-travel guard shared by the overlay selection hooks.
//
// Why this exists
// ---------------
// React Three Fiber fires a synthetic `onClick` for every object that was
// under the pointer at pointer-DOWN (its `internal.initialHits` set) and
// applies NO travel threshold to the handler itself — the `delta <= 2` check
// in R3F only suppresses the empty-space "miss" path, never a hit. A whole
// overlay (e.g. AI sections) is one merged mesh, so that single eventObject
// lands in `initialHits` whenever the ray passes through it — including when
// it sits beneath a `depthTest:false` gizmo handle at the point the user
// grabs the gizmo. Releasing the drag over a different section / resource
// then re-fires that mesh's onClick at the release face, switching the
// Selection to whatever sits under the cursor when the move ends.
//
// We close the gap by recording the pointer-down position and letting the
// selection hooks bail out of a click whose pointer travelled far enough to
// be a drag (a gizmo move or a camera orbit) rather than a deliberate pick.

// Squared-distance threshold in CSS px. R3F uses 2px for its own miss cutoff;
// 4px leaves a little slack for hand jitter on a real click while still
// catching any genuine drag-release.
const DRAG_THRESHOLD_PX = 4;

let lastPointerDown: { x: number; y: number } | null = null;
let attached = false;

// Record the latest pointer-down location. Exported (not test-only) so the
// guard's behaviour can be exercised without a DOM — a PointerEvent satisfies
// the `{ clientX, clientY }` shape at the call site.
export function recordPointerDown(e: { clientX: number; clientY: number }): void {
	lastPointerDown = { x: e.clientX, y: e.clientY };
}

// Attach the window-level pointer-down recorder exactly once. Capture phase so
// it runs before any target-phase `stopPropagation`, guaranteeing the down
// position is recorded even when the gizmo handle stops the event. No-ops under
// a node test environment where `window` is undefined (same guard pattern as
// `setBodyCursor`).
export function ensureDragGuardListener(): void {
	if (attached || typeof window === 'undefined') return;
	window.addEventListener('pointerdown', recordPointerDown, { capture: true });
	attached = true;
}

// Pure travel test — true when (upX, upY) is more than `threshold` px from
// `down`, i.e. the gesture should count as a drag rather than a click.
export function travelExceeds(
	down: { x: number; y: number } | null,
	upX: number,
	upY: number,
	threshold = DRAG_THRESHOLD_PX,
): boolean {
	if (!down) return false;
	const dx = upX - down.x;
	const dy = upY - down.y;
	return dx * dx + dy * dy > threshold * threshold;
}

// True when the click at (upX, upY) ends a drag begun at the last recorded
// pointer-down. Selection hooks call this to skip selecting on a drag-release.
export function isDragRelease(upX: number, upY: number): boolean {
	return travelExceeds(lastPointerDown, upX, upY);
}

// Attach on import. The selection hooks import this module, which the overlays
// import in turn, so the recorder is live before the user can interact with
// the 3D scene. Idempotent + window-guarded for node tests.
ensureDragGuardListener();
