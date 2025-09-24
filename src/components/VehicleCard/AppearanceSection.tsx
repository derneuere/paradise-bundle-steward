import { Palette } from "lucide-react";
import { ComponentStyles, getLiveryTypeLabel } from '@/lib/burnoutTheme';
import type { VehicleListEntry } from '@/lib/core/vehicleList';

type AppearanceSectionProps = {
  vehicle: VehicleListEntry;
}

export const AppearanceSection = ({ vehicle }: AppearanceSectionProps) => {
  return (
    <div className="border rounded-lg p-3">
      <h4 className={ComponentStyles.sectionTitle}>
        <Palette className="h-3 w-3 text-purple-500" />
        Appearance
      </h4>
      <div className={ComponentStyles.statGrid}>
        <div>
          <span className={ComponentStyles.statLabel}>Livery:</span>
          <span className="ml-1 font-medium">
            {getLiveryTypeLabel(vehicle.liveryType)}
          </span>
        </div>
        <div>
          <span className={ComponentStyles.statLabel}>Color:</span>
          <span className="ml-1 font-mono">
            {vehicle.colorIndex}
          </span>
        </div>
        <div>
          <span className={ComponentStyles.statLabel}>Palette:</span>
          <span className="ml-1 font-mono">
            {vehicle.paletteIndex}
          </span>
        </div>
        {vehicle.wheelName && (
          <div className="col-span-2">
            <span className={ComponentStyles.statLabel}>Wheels:</span>
            <span className="ml-1 font-medium text-xs">
              {vehicle.wheelName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}; 