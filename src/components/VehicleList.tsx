import { VehicleCard } from './VehicleCard/VehicleCard';
import { Button } from '@/components/ui/button';
import { Plus, Download } from 'lucide-react';
import type { VehicleListEntry } from '@/lib/parsers/vehicleListParser';

type VehicleListProps = {
  vehicles: VehicleListEntry[];
  onAddVehicle?: () => void;
  onEditVehicle?: (vehicle: VehicleListEntry) => void;
  onDeleteVehicle?: (vehicle: VehicleListEntry) => void;
  onExportBundle?: () => void;
}

export const VehicleList = ({ 
  vehicles, 
  onAddVehicle, 
  onEditVehicle, 
  onDeleteVehicle, 
  onExportBundle 
}: VehicleListProps) => {
  if (vehicles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-4">
        <p>No vehicles found in the bundle.</p>
        {onAddVehicle && (
          <Button onClick={onAddVehicle} className="gap-2">
            <Plus className="h-4 w-4" />
            Add First Vehicle
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">
          Vehicle List
        </h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
            {vehicles.length} vehicles
          </div>
          <div className="flex gap-2">
            {onAddVehicle && (
              <Button onClick={onAddVehicle} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Vehicle
              </Button>
            )}
            {onExportBundle && (
              <Button onClick={onExportBundle} size="sm" variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export Bundle
              </Button>
            )}
          </div>
        </div>
      </div>
      
      <div className="grid gap-6 grid-cols-2">
        {vehicles.map((vehicle, index) => (
          <VehicleCard 
            key={`${vehicle.id}-${index}`} 
            vehicle={vehicle}
            onEdit={onEditVehicle}
            onDelete={onDeleteVehicle}
          />
        ))}
      </div>
    </div>
  );
};