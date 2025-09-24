import { Badge } from "@/components/ui/badge";
import { getBoostTypeColors, getBoostTypeLabel, getVehicleTypeLabel, BurnoutColors } from '@/lib/burnoutTheme';
import type { VehicleListEntry } from '@/lib/core/vehicleList';

type VehicleHeaderProps = {
  vehicle: VehicleListEntry;
}

export const VehicleHeader = ({ vehicle }: VehicleHeaderProps) => {
  const boostColors = getBoostTypeColors(vehicle.boostType);
  
  return (
    <div className="space-y-3">
      {/* Vehicle Info */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-foreground leading-tight text-lg">
            {vehicle.vehicleName}
          </h3>
          {vehicle.manufacturer && (
            <p className="text-sm text-muted-foreground">{vehicle.manufacturer}</p>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            🚗 {getVehicleTypeLabel(vehicle.vehicleType)}
          </div>
        </div>
        
        {/* Boost Type Badge */}
        <Badge 
          className={`${boostColors.bg} ${boostColors.text} ${boostColors.border} shrink-0 font-medium`}
        >
          {getBoostTypeLabel(vehicle.boostType)}
        </Badge>
      </div>

      {/* Vehicle IDs */}
      <div className="flex flex-wrap gap-2 text-xs">
        <div className={`font-mono ${BurnoutColors.primary.text} ${BurnoutColors.primary.bg} px-2 py-1 rounded`}>
          🆔 {vehicle.id}
        </div>
        {vehicle.parentId && (
          <div className="font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
            👨‍👩‍👧‍👦 {vehicle.parentId}
          </div>
        )}
      </div>
    </div>
  );
}; 