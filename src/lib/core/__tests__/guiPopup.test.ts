// Gold coverage for parseGuiPopup / writeGuiPopup.
//
// example/POPUPS.PUP carries exactly one 0x1F resource that decompresses to
// 21824 bytes — 111 popups. This suite pins hand-verified decoded values,
// the data invariants the probe sweep established (CgsID derivation, params
// counting, the constant garbage pads), byte-exact round-trip, writer
// idempotence, and the popup-count growth paths the lone fixture can't show
// (the pointer-array alignment pad changes with count).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseGuiPopup,
	writeGuiPopup,
	countMessageParamsUsed,
	POPUP_STYLES,
	POPUP_ICONS,
	type GuiPopup,
} from '../guiPopup';
import { encodeCgsId } from '../cgsid';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GUI_POPUP_TYPE_ID = 0x1f;

function loadRaw(bundleFile: string): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const matches = bundle.resources.filter((r) => r.resourceTypeId === GUI_POPUP_TYPE_ID);
	expect(matches.length).toBe(1);
	return extractResourceRaw(buffer, bundle, matches[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const raw = loadRaw('example/POPUPS.PUP');
const model = parseGuiPopup(raw);

describe('GuiPopup gold values (example/POPUPS.PUP)', () => {
	it('decompresses to 21824 bytes carrying 111 popups', () => {
		expect(raw.byteLength).toBe(21824);
		expect(model.popups.length).toBe(111);
	});

	it('decodes popup 0 — FLConfirmDel, an untitled online Yes/No confirm', () => {
		const p = model.popups[0];
		expect(p.macName).toBe('FLConfirmDel');
		expect(p.mNameId).toBe(0x6c52c61194a130c0n);
		expect(p.meStyle).toBe(5); // CrashNav online — OK/Cancel
		expect(p.meIcon).toBe(0);
		expect(p.macTitleId).toBe('');
		expect(p.macMessageId).toBe('ONLINE_FRIENDS_CONFIRM_DELETE');
		expect(p.maeMessageParams).toEqual([1, 0]); // one String param
		expect(p.miMessageParamsUsed).toBe(1);
		expect(p.macButton1Id).toBe('GENERAL_OPTION_YES');
		expect(p.macButton2Id).toBe('GENERAL_OPTION_NO');
		expect(p.meButton1Param).toBe(0);
		expect(p.mbButton1ParamUsed).toBe(false);
	});

	it('decodes popup 5 — CNVidOptWarn, a buttonless warning-icon wait card', () => {
		const p = model.popups[5];
		expect(p.macName).toBe('CNVidOptWarn');
		expect(p.meStyle).toBe(6); // In-game — wait
		expect(p.meIcon).toBe(1); // Warning
		expect(p.macTitleId).toBe('VIDEO_OPTION_CHANGE_WARN_TITLE');
		expect(p.macMessageId).toBe('VIDEO_OPTION_CHANGE_WARN_BODY');
		expect(p.macButton1Id).toBe('');
		expect(p.macButton2Id).toBe('');
	});

	it('decodes popup 55 — CNOnlLchGame, a two-param message (String + String ID)', () => {
		const p = model.popups[55];
		expect(p.macName).toBe('CNOnlLchGame');
		expect(p.maeMessageParams).toEqual([1, 2]);
		expect(p.miMessageParamsUsed).toBe(2);
	});

	it('keeps tilde-prefixed Language keys verbatim', () => {
		// Several retail keys start with '~' (meaning unconfirmed) — they must
		// survive as plain text, not be treated as markup.
		expect(model.popups[12].macMessageId).toBe('~ONLINE_SYNCHING_KICKED');
	});

	it('ends with PrizeTicket — the v1.9 island-era additions sit last', () => {
		expect(model.popups[110].macName).toBe('PrizeTicket');
	});

	it('pins the style histogram (styles 0, 2, 3, and 13–15 are unused in retail)', () => {
		const styles = new Map<number, number>();
		for (const p of model.popups) styles.set(p.meStyle, (styles.get(p.meStyle) ?? 0) + 1);
		expect(Object.fromEntries(styles)).toEqual({
			1: 3, 4: 25, 5: 11, 6: 5, 7: 26, 8: 16, 9: 12, 10: 5, 11: 3, 12: 5,
		});
		for (const p of model.popups) {
			expect(POPUP_STYLES.some((s) => s.value === p.meStyle)).toBe(true);
			expect(POPUP_ICONS.some((s) => s.value === p.meIcon)).toBe(true);
		}
	});

	it('uses the warning icon on 17 of 111 popups', () => {
		expect(model.popups.filter((p) => p.meIcon === 1).length).toBe(17);
	});
});

describe('GuiPopup data invariants (probe-swept across all 111 popups)', () => {
	it('mNameId is always encodeCgsId(macName.toUpperCase())', () => {
		for (const p of model.popups) {
			expect(p.mNameId, p.macName).toBe(encodeCgsId(p.macName.toUpperCase()));
		}
	});

	it('miMessageParamsUsed always equals the leading non-Unused param count', () => {
		for (const p of model.popups) {
			expect(p.miMessageParamsUsed, p.macName).toBe(countMessageParamsUsed(p.maeMessageParams));
		}
	});

	it('button params are never used in retail', () => {
		for (const p of model.popups) {
			expect(p.meButton1Param).toBe(0);
			expect(p.meButton2Param).toBe(0);
			expect(p.mbButton1ParamUsed).toBe(false);
			expect(p.mbButton2ParamUsed).toBe(false);
		}
	});

	it('record pads carry the same bytes in every record: zero at +0x15, fixed garbage at +0xB1/+0xB9', () => {
		for (const p of model.popups) {
			expect(p._pad15).toEqual([0, 0, 0]);
			// Uninitialised build-machine memory, identical across all 111
			// records — the struct template was memcpy'd. Preserved verbatim.
			expect(p._padB1).toEqual([0xf9, 0x4f, 0x00]);
			expect(p._padB9).toEqual([0xdf, 0x9c, 0x00, 0xe0, 0x24, 0x9d, 0x00]);
		}
	});
});

describe('GuiPopup round-trip', () => {
	it('round-trips byte-for-byte', () => {
		const rewritten = writeGuiPopup(parseGuiPopup(raw));
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const once = writeGuiPopup(parseGuiPopup(raw));
		const twice = writeGuiPopup(parseGuiPopup(once));
		expect(bytesEqual(once, twice)).toBe(true);
	});
});

describe('GuiPopup writer layout recompute', () => {
	function makePopup(macName: string): GuiPopup {
		return {
			mNameId: encodeCgsId(macName.toUpperCase()),
			macName,
			meStyle: 7,
			meIcon: 0,
			macTitleId: '',
			macMessageId: 'PLACEHOLDER_TEMP_STRING',
			maeMessageParams: [0, 0],
			miMessageParamsUsed: 0,
			macButton1Id: 'GENERAL_OPTION_OK',
			meButton1Param: 0,
			mbButton1ParamUsed: false,
			macButton2Id: '',
			meButton2Param: 0,
			mbButton2ParamUsed: false,
			_pad15: [0, 0, 0],
			_padB1: [0, 0, 0],
			_padB9: [0, 0, 0, 0, 0, 0, 0],
		};
	}

	it('112 popups need no pointer-array pad (0x40 + 112*4 is already 16-aligned)', () => {
		const grown = { popups: [...model.popups, makePopup('AddedOne')] };
		const bytes = writeGuiPopup(grown);
		expect(bytes.byteLength).toBe(0x200 + 112 * 0xc0);
		const reparsed = parseGuiPopup(bytes);
		expect(reparsed.popups.length).toBe(112);
		expect(reparsed.popups[111].macName).toBe('AddedOne');
		expect(reparsed.popups[0]).toEqual(model.popups[0]);
	});

	it('113 popups grow the pad to 12 bytes (parser re-accepts its own alignment)', () => {
		const grown = { popups: [...model.popups, makePopup('AddedOne'), makePopup('AddedTwo')] };
		const bytes = writeGuiPopup(grown);
		expect(bytes.byteLength).toBe(0x210 + 113 * 0xc0);
		expect(parseGuiPopup(bytes).popups.length).toBe(113);
	});

	it('shrinking to a handful of popups still round-trips through the parser', () => {
		const small = { popups: model.popups.slice(0, 3) };
		const bytes = writeGuiPopup(small);
		const reparsed = parseGuiPopup(bytes);
		expect(reparsed.popups).toEqual(small.popups);
		expect(bytesEqual(writeGuiPopup(reparsed), bytes)).toBe(true);
	});

	it('rejects a macName that cannot fit char[13]', () => {
		const broken = { popups: [{ ...model.popups[0], macName: 'ThirteenChars' }] };
		expect(() => writeGuiPopup(broken)).toThrow(/macName/);
	});

	it('rejects a Language key that cannot fit char[32]', () => {
		const broken = { popups: [{ ...model.popups[0], macMessageId: 'X'.repeat(32) }] };
		expect(() => writeGuiPopup(broken)).toThrow(/macMessageId/);
	});

	it('rejects a popup count whose resource size overflows i16 miSizeOfPopupResource', () => {
		// 170 records ≈ 33 KB > 0x7FFF — the header size field is int16_t.
		const huge = { popups: Array.from({ length: 170 }, (_, i) => makePopup(`Huge${i}`)) };
		expect(() => writeGuiPopup(huge)).toThrow(/miSizeOfPopupResource/);
	});
});
