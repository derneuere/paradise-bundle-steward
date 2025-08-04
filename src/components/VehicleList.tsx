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
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {vehicles.map((v) => (
            <li key={v.id} className="text-sm">
              {v.vehicleName ? `${v.vehicleName} (${v.id})` : v.id}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
