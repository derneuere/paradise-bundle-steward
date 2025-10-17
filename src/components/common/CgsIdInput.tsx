import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CgsId } from '@/lib/core/cgsid';
import { decodeCgsId, encodeCgsId } from '@/lib/core/cgsid';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type CgsIdInputProps = {
  label?: string;
  value: CgsId;
  onChange: (next: CgsId) => void;
  disabled?: boolean;
  allowHexToggle?: boolean;
  allowDecimalToggle?: boolean;
  isOnlyGameId?: boolean;
};

export const CgsIdInput: React.FC<CgsIdInputProps> = ({ label, value, onChange, disabled, allowHexToggle, allowDecimalToggle, isOnlyGameId }) => {
  const [mode, setMode] = React.useState<'text' | 'hex' | 'decimal'>(isOnlyGameId ? 'decimal' : 'text');
  React.useEffect(() => {
    if (isOnlyGameId) setMode('decimal');
  }, [isOnlyGameId]);

  const displayValue = mode === 'text'
    ? decodeCgsId(value)
    : mode === 'hex'
      ? (value === 0n ? '' : value.toString(16).toUpperCase())
      : (value === 0n ? '' : value.toString());

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    if (mode === 'hex') {
      const trimmed = text.trim();
      if (trimmed === '') {
        onChange(0n);
        return;
      }
      const sanitized = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`;
      try {
        onChange(BigInt(sanitized));
      } catch {
        // ignore invalid
      }
      return;
    } else if (mode === 'decimal') {
      const trimmed = text.trim();
      if (trimmed === '') {
        onChange(0n);
        return;
      }
      if (!/^\d+$/.test(trimmed)) return;
      try {
        onChange(BigInt(trimmed));
      } catch {
        // ignore invalid
      }
      return;
    }
    // text mode: encode string to cgsid
    try {
      const encoded = encodeCgsId(text);
      onChange(encoded);
    } catch {
      // ignore invalid
    }
  };

  return (
    <div>
      {label && <Label>{label}</Label>}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
        />
        {!isOnlyGameId && (allowHexToggle || allowDecimalToggle) && (
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              {allowHexToggle && <SelectItem value="hex">Hex</SelectItem>}
              {allowDecimalToggle && <SelectItem value="decimal">Dec</SelectItem>}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
};

export default CgsIdInput;


