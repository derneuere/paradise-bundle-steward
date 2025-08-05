import { Zap } from "lucide-react";
import { StatBar } from './StatBar';
import { ComponentStyles } from '@/lib/burnoutTheme';
import type { VehicleListEntry } from '@/lib/vehicleListParser';

interface PerformanceSectionProps {
  vehicle: VehicleListEntry;
}

export const PerformanceSection = ({ vehicle }: PerformanceSectionProps) => {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <h4 className={ComponentStyles.sectionTitle}>
        <Zap className="h-3 w-3 text-blue-500" />
        Performance
      </h4>
      <div className="space-y-2">
        <StatBar 
          value={vehicle.topSpeedNormalGUIStat} 
          label="Speed" 
          type="speed" 
        />
        <StatBar 
          value={vehicle.topSpeedBoostGUIStat} 
          label="Boost" 
          type="speed" 
        />
        <StatBar 
          value={vehicle.gamePlayData.strengthStat} 
          label="Strength" 
          type="strength" 
        />
      </div>
    </div>
  );
}; 