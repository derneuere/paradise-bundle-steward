import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { VehicleHeader } from './VehicleHeader';
import { PerformanceSection } from './PerformanceSection';
import { GameplaySection } from './GameplaySection';
import { AppearanceSection } from './AppearanceSection';
import { AudioSection } from './AudioSection';
import { TechnicalSection } from './TechnicalSection';
import type { VehicleListEntry } from '@/lib/core/vehicleList';

type VehicleCardProps = {
  vehicle: VehicleListEntry;
  onEdit?: (vehicle: VehicleListEntry) => void;
  onDelete?: (vehicle: VehicleListEntry) => void;
}

export const VehicleCard = ({ vehicle, onEdit, onDelete }: VehicleCardProps) => {
  return (
    <Card className="h-fit border rounded-lg hover:shadow-lg transition-all duration-200">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <VehicleHeader vehicle={vehicle} />
          </div>
          <div className="flex items-center gap-2 ml-4">
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(vehicle)}
                className="h-8 w-8 p-0"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(vehicle)}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="space-y-3">
          <PerformanceSection vehicle={vehicle} />
          
          <div className="grid grid-cols-1 gap-3">
            <GameplaySection vehicle={vehicle} />
            <AppearanceSection vehicle={vehicle} />
            <AudioSection vehicle={vehicle} />
          </div>
        </div>
        
        <TechnicalSection vehicle={vehicle} />
      </CardContent>
    </Card>
  );
}; 