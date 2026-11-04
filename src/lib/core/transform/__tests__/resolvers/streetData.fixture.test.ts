// Byte-exactness backstop for the shared transform, against the real
// BTTSTREETDATA.DAT fixture.
//
// The reference-identity contract in `Resolver.write` is not a perf tweak: an
// overlay commits with `if (next !== data)`, and a Bundle that never sees a
// changed model reference is never re-encoded. This test closes the loop the
// unit tests can only assert structurally — parse the shipped resource, run a
// zero delta through `transform()`, re-encode, and require the exact same
// bytes the writer produces with no transform in the path at all.
//
// The expected sha1 is the one pinned by `streetData.test.ts`: the C# writer
// drops per-junction exits / per-road spans and pads for the retail FixUp()
// bug, so the re-encoded resource is smaller than the parsed slice.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { parseBundle } from '../../../bundle';
import { RESOURCE_TYPE_IDS } from '../../../types';
import { extractResourceSize, isCompressed, decompressData } from '../../../resourceManager';
import { parseStreetDataData, writeStreetDataData } from '../../../streetData';
import { streetDataResolver, type StreetDataRef } from '../../resolvers/streetData';
import { transform } from '../../transform';
import { delta } from '../_helpers';

const FIXTURE = path.resolve(__dirname, '../../../../../../example/BTTSTREETDATA.DAT');
const WRITTEN_SHA1 = '12a3ab4dde5244bc6bf2f0ad3bf11b1530edfa4c';

function sha1(bytes: Uint8Array): string {
	return createHash('sha1').update(bytes).digest('hex');
}

function loadStreetDataRaw(): Uint8Array {
	const raw = fs.readFileSync(FIXTURE);
	const bytes = new Uint8Array(raw.byteLength);
	bytes.set(raw);
	const buffer = bytes.buffer;

	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === RESOURCE_TYPE_IDS.STREET_DATA);
	if (!resource) throw new Error('Fixture missing StreetData resource');
	for (let bi = 0; bi < 3; bi++) {
		const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
		if (size <= 0) continue;
		const base = bundle.header.resourceDataOffsets[bi] >>> 0;
		const rel = resource.diskOffsets[bi] >>> 0;
		const start = (base + rel) >>> 0;
		let slice: Uint8Array<ArrayBuffer> = new Uint8Array(buffer.slice(start, start + size));
		if (isCompressed(slice)) slice = decompressData(slice) as Uint8Array<ArrayBuffer>;
		return slice;
	}
	throw new Error('StreetData resource had no populated block');
}

describe('streetData identity round-trip through transform()', () => {
	it('re-encodes BTTSTREETDATA.DAT byte-for-byte after a zero-delta transform', () => {
		const sd = parseStreetDataData(loadStreetDataRaw());
		expect(sd.roads.length).toBeGreaterThan(0);

		// Every road in the resource is selected, so the only reason the bytes
		// could survive is that the transform genuinely wrote nothing.
		const refs: StreetDataRef[] = sd.roads.map((_road, roadIdx) => ({ kind: 'road', roadIdx }));

		const next = transform(sd, refs, delta(), streetDataResolver);
		expect(next).toBe(sd);
		expect(sha1(writeStreetDataData(next))).toBe(WRITTEN_SHA1);
	});

	it('leaves the bytes alone when a gesture resolves to the positions already stored', () => {
		// A drag that ends where it started still reaches `write` with a full
		// slot list (the identity guard in `transform` only catches an exactly
		// zero delta). The resolver's value comparison is what keeps the Bundle
		// clean, and this is the assertion that pins it.
		const sd = parseStreetDataData(loadStreetDataRaw());
		const refs: StreetDataRef[] = sd.roads.map((_road, roadIdx) => ({ kind: 'road', roadIdx }));

		const writes = refs.map((ref) => ({
			slot: ref,
			point: { ...sd.roads[ref.roadIdx].mReferencePosition },
			spin: null,
		}));
		const next = streetDataResolver.write(sd, writes);
		expect(next).toBe(sd);
		expect(sha1(writeStreetDataData(next))).toBe(WRITTEN_SHA1);
	});
});
