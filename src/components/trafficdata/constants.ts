import type { ParsedTrafficData, TrafficHull } from '@/lib/core/trafficData';

// ---------------------------------------------------------------------------
// Hull-level immutable updater
// ---------------------------------------------------------------------------

export function updateHullField<K extends keyof TrafficHull>(
	data: ParsedTrafficData,
	hullIndex: number,
	key: K,
	updater: (current: TrafficHull[K]) => TrafficHull[K],
): ParsedTrafficData {
	const hulls = data.hulls.slice();
	hulls[hullIndex] = { ...hulls[hullIndex], [key]: updater(hulls[hullIndex][key]) };
	return { ...data, hulls };
}

export function updateHull(
	data: ParsedTrafficData,
	hullIndex: number,
	patch: Partial<TrafficHull>,
): ParsedTrafficData {
	const hulls = data.hulls.slice();
	hulls[hullIndex] = { ...hulls[hullIndex], ...patch };
	return { ...data, hulls };
}

// ---------------------------------------------------------------------------
// Rung-to-section lookup
// ---------------------------------------------------------------------------

export function buildRungToSectionMap(hull: TrafficHull): Int32Array {
	const map = new Int32Array(hull.rungs.length).fill(-1);
	for (let si = 0; si < hull.sections.length; si++) {
		const sec = hull.sections[si];
		for (let r = 0; r < sec.muNumRungs; r++) {
			const ri = sec.muRungOffset + r;
			if (ri < map.length) map[ri] = si;
		}
	}
	return map;
}

// ---------------------------------------------------------------------------
// Speed color helpers (for 3D viewport)
// ---------------------------------------------------------------------------

/** Map a section speed float to an RGB tuple for the viewport. Green = slow, red = fast. */
export function speedToRGB(speed: number): [number, number, number] {
	const maxSpeed = 50; // approximate max m/s in traffic data
	const t = Math.min(speed / maxSpeed, 1);
	return [t, 1 - t, 0.15];
}

// ---------------------------------------------------------------------------
// Hull color palette (distinct colors per hull)
// ---------------------------------------------------------------------------

const HULL_HUES = [210, 30, 120, 330, 60, 270, 0, 180, 150, 300];

export function hullColor(hullIndex: number): string {
	const hue = HULL_HUES[hullIndex % HULL_HUES.length];
	return `hsl(${hue}, 65%, 55%)`;
}

// ---------------------------------------------------------------------------
// Vehicle flag names
// ---------------------------------------------------------------------------

export const VEHICLE_FLAG_NAMES: { flag: number; label: string }[] = [
	{ flag: 0x01, label: 'Trailer' },
	{ flag: 0x02, label: 'Bus' },
	{ flag: 0x04, label: 'Taxi' },
	{ flag: 0x08, label: 'Emergency' },
	{ flag: 0x10, label: 'Bike' },
	{ flag: 0x20, label: 'Truck' },
];

// ---------------------------------------------------------------------------
// Vehicle class labels (BrnTraffic::VehicleClass)
// ---------------------------------------------------------------------------

export const VEHICLE_CLASS_LABELS: Record<number, string> = {
	0: 'Car',
	1: 'Van',
	2: 'Bus',
	3: 'Big Rig',
};

// ---------------------------------------------------------------------------
// Flow type reference counts
// ---------------------------------------------------------------------------

export type FlowTypeReferences = {
	sectionFlows: number;
	staticVehicles: number;
	trailers: number;
};

export function countFlowTypeReferences(data: ParsedTrafficData, flowTypeIndex: number): FlowTypeReferences {
	let sectionFlows = 0;
	let staticVehicles = 0;
	for (const hull of data.hulls) {
		for (const sf of hull.sectionFlows) {
			if (sf.muFlowTypeId === flowTypeIndex) sectionFlows++;
		}
		for (const sv of hull.staticTrafficVehicles) {
			if (sv.mFlowTypeID === flowTypeIndex) staticVehicles++;
		}
	}
	let trailers = 0;
	for (const vt of data.vehicleTypes) {
		if (vt.muTrailerFlowTypeId === flowTypeIndex) trailers++;
	}
	return { sectionFlows, staticVehicles, trailers };
}
