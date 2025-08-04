import { extractResourceSize, type ResourceEntry } from './bundleParser';

export interface VehicleListEntry {
  id: string;
  parentId: string;
  vehicleName: string;
  manufacturer: string;
  wheelName: string;
}

function decodeCgsId(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < 8; i++) {
    const b = bytes[i];
    if (b === 0) break;
    result += String.fromCharCode(b);
  }
  return result;
}

function decodeString(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;
  return new TextDecoder().decode(bytes.slice(0, end));
}

function getResourceData(buffer: ArrayBuffer, resource: ResourceEntry): Uint8Array {
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
    if (size > 0) {
      const offset = resource.diskOffsets[i];
      return new Uint8Array(buffer, offset, size);
    }
  }
  return new Uint8Array();
}

export function parseVehicleList(buffer: ArrayBuffer, resource: ResourceEntry): VehicleListEntry[] {
  const data = getResourceData(buffer, resource);
  if (data.byteLength === 0) return [];

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let numVehicles = view.getUint32(0, true);

  // Detect 64-bit layout where the first field is a pointer
  if (numVehicles > 1000) {
    numVehicles = view.getUint32(8, true);
  }

  const entries: VehicleListEntry[] = [];
  const entrySize = 0x108; // 264 bytes per entry
  const offset = 0x10; // entries start after resource header

  for (let i = 0; i < numVehicles; i++) {
    const base = offset + i * entrySize;
    const entryBytes = new Uint8Array(data.buffer, data.byteOffset + base, entrySize);
    const id = decodeCgsId(entryBytes.subarray(0, 8));
    const parentId = decodeCgsId(entryBytes.subarray(8, 16));
    const wheelName = decodeString(entryBytes.subarray(0x10, 0x10 + 32));
    const vehicleName = decodeString(entryBytes.subarray(0x30, 0x30 + 64));
    const manufacturer = decodeString(entryBytes.subarray(0x70, 0x70 + 32));

    entries.push({ id, parentId, wheelName, vehicleName, manufacturer });
  }

  return entries;
}
