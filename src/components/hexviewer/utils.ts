import type { ResourceCategory } from '@/lib/resourceTypes';
import type { AnySchema, MaxValue } from 'typed-binary';

export const formatHex = (byte: number): string => {
  return byte.toString(16).toUpperCase().padStart(2, '0');
};

export const formatAscii = (byte: number): string => {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
};

export const shadesForCategory = (category: ResourceCategory): [string, string, string] => {
  switch (category) {
    case 'Graphics': return ['bg-blue-500', 'bg-blue-600', 'bg-blue-700'];
    case 'Audio': return ['bg-green-500', 'bg-green-600', 'bg-green-700'];
    case 'Data': return ['bg-purple-500', 'bg-purple-600', 'bg-purple-700'];
    case 'Script': return ['bg-orange-500', 'bg-orange-600', 'bg-orange-700'];
    case 'Camera': return ['bg-cyan-500', 'bg-cyan-600', 'bg-cyan-700'];
    default: return ['bg-gray-500', 'bg-gray-600', 'bg-gray-700'];
  }
};


// ============================================================================
// Schema Introspection (fields list from typed-binary schema)
// ============================================================================

export type SchemaField = {
  key: string;
  name: string;
  offset: number;
  size: number;
};

function unwrapSchema(schema: any): any {
  // Unwrap common wrappers used by typed-binary
  if (schema && typeof schema === 'object') {
    if ('innerType' in schema && schema.innerType) return unwrapSchema(schema.innerType);
    if ('innerSchema' in schema && schema.innerSchema) return unwrapSchema(schema.innerSchema);
  }
  return schema;
}

function isObjectSchema(schema: any): schema is { properties: Record<string, AnySchema> } {
  return schema && typeof schema === 'object' && typeof schema.properties === 'object';
}

function isArraySchema(schema: any): schema is { elementSchema: AnySchema; length: number } {
  return schema && typeof schema === 'object' && 'elementSchema' in schema && typeof schema.length === 'number';
}

function isTypedArraySchema(schema: any): schema is { byteLength: number } {
  return schema && typeof schema === 'object' && typeof schema.byteLength === 'number' && 'length' in schema && '_arrayConstructor' in schema;
}

function isU64Like(schema: any): boolean {
  // Heuristic: object with exactly { low: u32, high: u32 } (order preserved)
  const s = unwrapSchema(schema);
  if (!isObjectSchema(s)) return false;
  const entries = Object.entries(s.properties);
  if (entries.length !== 2) return false;
  const [k0, v0] = entries[0];
  const [k1, v1] = entries[1];
  if (k0 !== 'low' || k1 !== 'high') return false;
  const sz0 = sizeOfSchema(v0);
  const sz1 = sizeOfSchema(v1);
  return sz0 === 4 && sz1 === 4;
}

function sizeOfSchema(schema: any): number {
  const s = unwrapSchema(schema);
  if (isTypedArraySchema(s)) return s.byteLength;
  if (isArraySchema(s)) return sizeOfSchema(s.elementSchema) * s.length;
  // Prefer measure(MaxValue) which all schemas implement; falls back to 0 if unavailable
  try {
    const meas = s.measure?.(MaxValue);
    if (meas && typeof meas.size === 'number') return meas.size >>> 0;
  } catch {}
  // Scalar base types expose maxSize
  if (typeof s.maxSize === 'number') return s.maxSize >>> 0;
  // Object schema: sum child sizes in order
  if (isObjectSchema(s)) {
    let total = 0;
    for (const [, child] of Object.entries(s.properties)) total += sizeOfSchema(child);
    return total >>> 0;
  }
  return 0;
}

function collectFields(schema: any, baseOffset: number, baseKey: string, out: SchemaField[]): number {
  const s = unwrapSchema(schema);
  if (isObjectSchema(s)) {
    let offset = baseOffset;
    for (const [propName, propSchema] of Object.entries(s.properties)) {
      const prop = unwrapSchema(propSchema);
      const propOffset = offset;
      const propSize = sizeOfSchema(prop);

      const key = baseKey ? `${baseKey}.${propName}` : propName;

      if (isU64Like(prop)) {
        out.push({ key, name: key, offset: propOffset, size: 8 });
      } else if (isTypedArraySchema(prop) || isArraySchema(prop)) {
        // Treat fixed-length arrays as a single field block
        out.push({ key, name: key, offset: propOffset, size: propSize });
      } else if (isObjectSchema(prop)) {
        collectFields(prop, propOffset, key, out);
      } else {
        // Scalar
        out.push({ key, name: key, offset: propOffset, size: propSize });
      }

      offset += propSize;
    }
    return offset - baseOffset;
  } else {
    const size = sizeOfSchema(s);
    out.push({ key: baseKey || 'field', name: baseKey || 'field', offset: baseOffset, size });
    return size;
  }
}

export function getSchemaFields(schema: AnySchema): SchemaField[] {
  const fields: SchemaField[] = [];
  collectFields(schema as any, 0, '', fields);
  return fields;
}