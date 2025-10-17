// CgsID encode/decode utilities based on Criterion's compressed string mapping
// Allowed character set modeled from provided reference implementation

export type CgsId = bigint;

// Encode a string (max 12 chars) to CgsId (base-40 packing)
export function encodeCgsId(input: string): CgsId {
  if (!input || input.length === 0) return 0n;
  if (input.length > 12) {
    throw new Error('CgsID input must be 12 characters or less');
  }

  let encoded = 0n;
  for (let i = 0; i < 12; i++) {
    let chr = 0;
    if (i < input.length) chr = input.charCodeAt(i);
    if (chr === 0) chr = 32; // space padding

    let digit: number;
    if (chr === 95) {
      // '_'
      digit = 39;
    } else if (chr >= 65) {
      // 'A'.. (covers uppercase letters and beyond per original mapping)
      digit = chr - 52; // A(65) -> 13 .. Z(90) -> 38
    } else if (chr >= 48) {
      // '0'..'9'
      digit = chr - 45; // 0(48) -> 3 .. 9(57) -> 12
    } else if (chr >= 47) {
      // '/'
      digit = 2;
    } else if (chr >= 45) {
      // '-'
      digit = 1;
    } else {
      // space or less
      digit = 0;
    }

    encoded = encoded * 40n + BigInt(digit);
  }
  return encoded;
}

// Decode a CgsId to string (trim trailing spaces)
export function decodeCgsId(id: CgsId): string {
  if (!id) return '';
  let value = id;
  const chars: number[] = [];
  for (let i = 0; i < 12; i++) {
    const mod = Number(value % 40n);
    let chr: number;
    if (mod === 39) {
      chr = 95; // '_'
    } else if (mod >= 13) {
      chr = mod + 52; // 13..38 -> 'A'..'Z'
    } else if (mod >= 3) {
      chr = mod + 45; // 3..12 -> '0'..'9'
    } else if (mod >= 2) {
      chr = 47; // '/'
    } else {
      // space mapping from reference: (mod - 1) & 32 yields 32 for 0 or 1
      chr = ((mod - 1) & 32);
    }
    chars.push(chr);
    value = value / 40n;
  }
  // reverse order (insert at front in C++), we collected least significant first
  chars.reverse();
  // trim trailing spaces
  while (chars.length > 0 && chars[chars.length - 1] === 32) {
    chars.pop();
  }
  return String.fromCharCode(...chars);
}

// Helpers to convert between bigint and UI strings
export function parseCgsIdInput(text: string): CgsId {
  // Accept either decimal bigint string or CGSID text prefixed with 'c:' or auto-detect non-digit
  const trimmed = text.trim();
  if (trimmed === '') return 0n;

  const isAllDigits = /^\d+$/.test(trimmed);
  if (isAllDigits) {
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  // Treat as CGSID text and encode
  return encodeCgsId(trimmed);
}

export function formatCgsIdForDisplay(id: CgsId, mode: 'text' | 'decimal' = 'text'): string {
  if (mode === 'decimal') return id.toString();
  const decoded = decodeCgsId(id);
  return decoded;
}


