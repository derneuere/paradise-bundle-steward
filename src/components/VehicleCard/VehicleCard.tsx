import { Card, CardContent } from "@/components/ui/card";
import { VehicleHeader } from './VehicleHeader';
import { PerformanceSection } from './PerformanceSection';
import { GameplaySection } from './GameplaySection';
import { AppearanceSection } from './AppearanceSection';
import { AudioSection } from './AudioSection';
import { TechnicalSection } from './TechnicalSection';
import type { VehicleListEntry } from '@/lib/parsers/vehicleListParser';

type VehicleCardProps = {
  vehicle: VehicleListEntry;
}

export const VehicleCard = ({ vehicle }: VehicleCardProps) => {
  return (
    <Card className="h-fit border rounded-lg hover:shadow-lg transition-all duration-200">
      <CardContent className="p-4 space-y-4">
        <VehicleHeader vehicle={vehicle} />
        
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