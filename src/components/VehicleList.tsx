import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car } from "lucide-react";
import type { VehicleListEntry } from "@/lib/vehicleListParser";

interface VehicleListProps {
  vehicles: VehicleListEntry[];
}

export const VehicleList = ({ vehicles }: VehicleListProps) => {
  if (vehicles.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="w-5 h-5" />
          Vehicle List
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {vehicles.map((vehicle, index) => (
            <div key={vehicle.id || index} className="p-3 border border-border rounded-lg bg-card/50">
              <div className="font-mono text-sm text-primary">{vehicle.id || `Vehicle ${index + 1}`}</div>
              <div className="font-semibold text-foreground">{vehicle.vehicleName || 'Unknown Vehicle'}</div>
              {vehicle.manufacturer && (
                <div className="text-sm text-muted-foreground">{vehicle.manufacturer}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                Type: {vehicle.vehicleType === 0 ? 'Car' : vehicle.vehicleType === 1 ? 'Bike' : 'Plane'}
                {vehicle.topSpeedNormal > 0 && ` • Speed: ${vehicle.topSpeedNormal}`}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};