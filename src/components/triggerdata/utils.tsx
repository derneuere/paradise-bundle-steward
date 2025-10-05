import { Input } from '@/components/ui/input';
import type { Vector4 } from '@/lib/core/triggerData';

export function numberField<T extends object>(obj: T, path: (keyof any)[], value: number): T {
  const next = { ...(obj as any) };
  let cur: any = next;
  for (let i = 0; i < path.length - 1; i++) {
    cur[path[i]] = { ...cur[path[i]] };
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
  return next as T;
}

export const vectorField = (v: Vector4, onVec: (nv: Vector4) => void) => (
  <div className="grid grid-cols-4 gap-2">
    <Input value={v.x} type="number" step="0.01" onChange={e => onVec({ ...v, x: parseFloat(e.target.value)||0 })} />
    <Input value={v.y} type="number" step="0.01" onChange={e => onVec({ ...v, y: parseFloat(e.target.value)||0 })} />
    <Input value={v.z} type="number" step="0.01" onChange={e => onVec({ ...v, z: parseFloat(e.target.value)||0 })} />
    <Input value={v.w} type="number" step="0.01" onChange={e => onVec({ ...v, w: parseFloat(e.target.value)||0 })} />
  </div>
);

export function parseBigIntInput(str: string): bigint {
  const t = str.trim();
  if (t.length === 0) return 0n;
  if (/^0x/i.test(t)) return BigInt(t);
  return BigInt(Number.parseInt(t, 10) || 0);
}

export function parseNumberArray(str: string): number[] {
  const cleaned = str.replace(/[^0-9,\-]/g, ',');
  return cleaned.split(',').map(s => Number.parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
}

export function parseBigIntArray(str: string): bigint[] {
  const parts = str.split(',');
  const out: bigint[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    try { out.push(parseBigIntInput(t)); } catch { /* ignore */ }
  }
  return out;
}


