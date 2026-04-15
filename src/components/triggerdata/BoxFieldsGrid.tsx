import React from 'react';
import type { BoxRegion, Vector3 } from '@/lib/core/triggerData';

// The model stores Position/Rotation/Dimensions as game-space Vector3s
// (`.x = east/west`, `.y = depth`, `.z = up`). The editor convention is
// Y-up, so display "Y" reads `.z` and display "Z" reads `.y`. This matches
// what the generic schema-editor `Vec3Field` does when `swapYZ` is set —
// keeping the two surfaces consistent.
type BoxGroupKey = 'position' | 'rotation' | 'dimensions';
type Axis = 'x' | 'y' | 'z';
type BoxAxis = { group: BoxGroupKey; axis: Axis; label: string };

const FIELD_DISPLAY: BoxAxis[] = [
  { group: 'position',   axis: 'x', label: 'PositionX' },
  { group: 'position',   axis: 'z', label: 'PositionY' },
  { group: 'position',   axis: 'y', label: 'PositionZ' },
  { group: 'rotation',   axis: 'x', label: 'RotationX' },
  { group: 'rotation',   axis: 'z', label: 'RotationY' },
  { group: 'rotation',   axis: 'y', label: 'RotationZ' },
  { group: 'dimensions', axis: 'x', label: 'DimensionX' },
  { group: 'dimensions', axis: 'z', label: 'DimensionY' },
  { group: 'dimensions', axis: 'y', label: 'DimensionZ' },
];

type BoxFieldsGridProps = {
  box: BoxRegion | null;
  onChange?: (group: BoxGroupKey, next: Vector3) => void;
};

export const BoxFieldsGrid: React.FC<BoxFieldsGridProps> = ({ box, onChange }) => {
  if (!box) return null;

  // Read-only mode: compact text display
  if (!onChange) {
    const groups = [
      { title: 'Position',   fields: FIELD_DISPLAY.slice(0, 3) },
      { title: 'Rotation',   fields: FIELD_DISPLAY.slice(3, 6) },
      { title: 'Dimensions', fields: FIELD_DISPLAY.slice(6, 9) },
    ];
    return (
      <>
        {groups.map(g => (
          <div key={g.title}>
            <div className="font-semibold">{g.title}:</div>
            <div className="pl-2">
              {g.fields.map((f, i) => (
                <span key={f.label}>
                  {f.label.replace(/^(Position|Rotation|Dimension)/, '')}: {box[f.group][f.axis].toFixed(2)}
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
      {FIELD_DISPLAY.map(({ group, axis, label }) => (
        <div key={label} className="flex flex-col gap-1">
          <label className="text-sm font-medium">{label}</label>
          <input
            type="number"
            step="any"
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={box[group][axis] ?? 0}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || val === '-') return;
              const next = { ...box[group], [axis]: Number.parseFloat(val) };
              onChange(group, next);
            }}
          />
        </div>
      ))}
    </div>
  );
};
