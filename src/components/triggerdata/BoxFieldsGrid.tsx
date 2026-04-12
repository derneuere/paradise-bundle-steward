import React from 'react';
import type { BoxRegion } from '@/lib/core/triggerData';

type BoxField = keyof BoxRegion;

// Game uses Y-up convention (X/Z = ground plane, Y = vertical).
// Real-world / CAD uses Z-up (X/Y = ground plane, Z = vertical).
// Swap display labels so users see real-world axis names.
const FIELD_DISPLAY: { field: BoxField; label: string }[] = [
  { field: 'positionX',  label: 'PositionX' },
  { field: 'positionZ',  label: 'PositionY' },
  { field: 'positionY',  label: 'PositionZ' },
  { field: 'rotationX',  label: 'RotationX' },
  { field: 'rotationZ',  label: 'RotationY' },
  { field: 'rotationY',  label: 'RotationZ' },
  { field: 'dimensionX', label: 'DimensionX' },
  { field: 'dimensionZ', label: 'DimensionY' },
  { field: 'dimensionY', label: 'DimensionZ' },
];

type BoxFieldsGridProps = {
  box: BoxRegion | null;
  onChange?: (field: BoxField, value: number) => void;
};

export const BoxFieldsGrid: React.FC<BoxFieldsGridProps> = ({ box, onChange }) => {
  if (!box) return null;

  // Read-only mode: compact text display
  if (!onChange) {
    const groups = [
      { title: 'Position',  fields: FIELD_DISPLAY.slice(0, 3) },
      { title: 'Rotation',  fields: FIELD_DISPLAY.slice(3, 6) },
      { title: 'Dimension', fields: FIELD_DISPLAY.slice(6, 9) },
    ];
    return (
      <>
        {groups.map(g => (
          <div key={g.title}>
            <div className="font-semibold">{g.title}:</div>
            <div className="pl-2">
              {g.fields.map((f, i) => (
                <span key={f.field}>
                  {f.label.replace(/^(Position|Rotation|Dimension)/, '')}: {box[f.field].toFixed(2)}
                  {i < 2 ? ', ' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </>
    );
  }

  // Editable mode: 3-column grid with inputs
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {FIELD_DISPLAY.map(({ field, label }) => (
        <div key={field} className="flex flex-col gap-1">
          <label className="text-sm font-medium">{label}</label>
          <input
            type="number"
            step="any"
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={box[field] ?? 0}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || val === '-') return;
              onChange(field, Number.parseFloat(val));
            }}
          />
        </div>
      ))}
    </div>
  );
};
