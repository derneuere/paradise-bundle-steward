import { useNavigate } from 'react-router-dom';
import { useBundle } from '@/context/BundleContext';
import { VehicleList } from '@/components/VehicleList';
import type { VehicleListEntry, ParsedVehicleList } from '@/lib/core/vehicleList';
import { CapabilityWarning } from '@/components/capabilities';

const VehiclesPage = () => {
  const navigate = useNavigate();
  const { getResource, setResource } = useBundle();
  const parsedVehicleList = getResource<ParsedVehicleList>('vehicleList');
  const vehicles: VehicleListEntry[] = parsedVehicleList?.vehicles ?? [];

  const handleAddVehicle = () => {
    navigate('/vehicleList/new');
  };
  const handleEditVehicle = (vehicle: VehicleListEntry) => {
    navigate(`/vehicleList/${vehicle.id.toString()}`);
  };
  const handleDeleteVehicle = (vehicleToDelete: VehicleListEntry) => {
    if (!parsedVehicleList) return;
    const updatedVehicles = vehicles.filter((v) => v.id !== vehicleToDelete.id);
    setResource('vehicleList', {
      ...parsedVehicleList,
      vehicles: updatedVehicles,
      header: { ...parsedVehicleList.header, numVehicles: updatedVehicles.length },
    });
  };
  const handleExportBundle = () => {
    navigate('/export');
  };

  return (
    <div className="space-y-4">
      <CapabilityWarning featureId="vehicle-list" />
      <VehicleList
        vehicles={vehicles}
        onAddVehicle={handleAddVehicle}
        onEditVehicle={handleEditVehicle}
        onDeleteVehicle={handleDeleteVehicle}
        onExportBundle={handleExportBundle}
      />
    </div>
  );
};

export default VehiclesPage;
