import { VehicleCard } from "./VehicleCard";
import type { VehicleListEntry } from "@/lib/parsers/vehicleListParser";

type VehicleListProps = {
  vehicles: VehicleListEntry[];
}

export const VehicleList = ({ vehicles }: VehicleListProps) => {
  if (vehicles.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <p>No vehicles found in the bundle.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">
          Vehicle List
        </h2>
        <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {vehicles.length} vehicles
        </div>
      </div>
      
      <div className="grid gap-6 grid-cols-2">
        {vehicles.map((vehicle, index) => (
          <VehicleCard key={`${vehicle.id}-${index}`} vehicle={vehicle} />
        ))}
      </div>
    </div>
  );
};