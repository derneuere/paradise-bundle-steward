// Colour-precedence resolution for the TriggerData overlay's non-hook meshes.
//
// The box InstancedMesh and the spawn cones both resolve their highlight tint
// through `pickRegionColor` / `pickRegionState`. This spec pins the precedence
// (primary > hover > bulk > base) so the box paint loop, the spawn material
// chooser, and useInstancedSelection can't silently diverge.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SELECTION_THEME } from '../selection/theme';
import { pickRegionColor, pickRegionState } from '../triggerOverlayColors';

const BASE = new THREE.Color(0x123456);

describe('pickRegionState', () => {
	it('primary wins over hover and bulk', () => {
		expect(pickRegionState({ isPrimary: true, isHovered: true, isBulk: true })).toBe('primary');
		expect(pickRegionState({ isPrimary: true, isHovered: false, isBulk: false })).toBe('primary');
	});

	it('hover wins over bulk (but not primary)', () => {
		expect(pickRegionState({ isPrimary: false, isHovered: true, isBulk: true })).toBe('hover');
		expect(pickRegionState({ isPrimary: false, isHovered: true, isBulk: false })).toBe('hover');
	});

	it('bulk wins over base', () => {
		expect(pickRegionState({ isPrimary: false, isHovered: false, isBulk: true })).toBe('bulk');
	});

	it('base when no flags set', () => {
		expect(pickRegionState({ isPrimary: false, isHovered: false, isBulk: false })).toBe('base');
	});
});

describe('pickRegionColor', () => {
	it('paints primary tint when primary (beats hover + bulk)', () => {
		const c = pickRegionColor({ isPrimary: true, isHovered: true, isBulk: true }, BASE, SELECTION_THEME);
		expect(c).toBe(SELECTION_THEME.primary);
	});

	it('paints hover tint when hovered but not primary (beats bulk)', () => {
		const c = pickRegionColor({ isPrimary: false, isHovered: true, isBulk: true }, BASE, SELECTION_THEME);
		expect(c).toBe(SELECTION_THEME.hover);
	});

	it('paints bulk tint when only bulk (beats base)', () => {
		const c = pickRegionColor({ isPrimary: false, isHovered: false, isBulk: true }, BASE, SELECTION_THEME);
		expect(c).toBe(SELECTION_THEME.bulk);
	});

	it('paints the base colour when no flag is set', () => {
		const c = pickRegionColor({ isPrimary: false, isHovered: false, isBulk: false }, BASE, SELECTION_THEME);
		expect(c).toBe(BASE);
	});

	it('bulk tint is the amber theme colour, distinct from primary', () => {
		expect(SELECTION_THEME.bulk.getHex()).toBe(0xffcc66);
		expect(SELECTION_THEME.bulk.getHex()).not.toBe(SELECTION_THEME.primary.getHex());
	});
});
