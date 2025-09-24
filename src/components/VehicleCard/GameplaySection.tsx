import { Trophy } from "lucide-react";
import { ComponentStyles, getRankLabel } from '@/lib/burnoutTheme';
import type { VehicleListEntry } from '@/lib/core/vehicleList';

type GameplaySectionProps = {
  vehicle: VehicleListEntry;
}

export const GameplaySection = ({ vehicle }: GameplaySectionProps) => {
  return (
    <div className="border rounded-lg p-3">
      <h4 className={ComponentStyles.sectionTitle}>
        <Trophy className="h-3 w-3 text-yellow-500" />
        Gameplay
      </h4>
      <div className={ComponentStyles.statGrid}>
        <div>
          <span className={ComponentStyles.statLabel}>Rank:</span>
          <span className="ml-1 font-medium">
            {getRankLabel(vehicle.gamePlayData.unlockRank)}
          </span>
        </div>
        <div>
          <span className={ComponentStyles.statLabel}>Damage:</span>
          <span className="ml-1 font-mono">
            {vehicle.gamePlayData.damageLimit.toFixed(1)}
          </span>
        </div>
        <div>
          <span className={ComponentStyles.statLabel}>Boost Bar:</span>
          <span className="ml-1 font-mono">
            {vehicle.gamePlayData.boostBarLength}
          </span>
        </div>
        <div>
          <span className={ComponentStyles.statLabel}>Boost Cap:</span>
          <span className="ml-1 font-mono">
            {vehicle.gamePlayData.boostCapacity}
          </span>
        </div>
      </div>
    </div>
  );
}; 