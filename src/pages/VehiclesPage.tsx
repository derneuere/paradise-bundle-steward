import { useNavigate } from 'react-router-dom';
import { useBundle } from '@/context/BundleContext';
import { VehicleList } from '@/components/VehicleList';
import type { VehicleListEntry } from '@/lib/core/vehicleList';

const VehiclesPage = () => {
  const navigate = useNavigate();
  const { vehicleList, setVehicleList, parsedVehicleList, setParsedVehicleList, setIsModified } = useBundle();

  const handleAddVehicle = () => {
    navigate('/vehicles/new');
  };
  const handleEditVehicle = (vehicle: VehicleListEntry) => {
    navigate(`/vehicles/${vehicle.id.toString()}`);
  };
  const handleDeleteVehicle = (vehicleToDelete: VehicleListEntry) => {
    const updatedVehicles = vehicleList.filter(v => v.id !== vehicleToDelete.id);
    setVehicleList(updatedVehicles);
    if (parsedVehicleList) {
      setParsedVehicleList({
        ...parsedVehicleList,
        vehicles: updatedVehicles,
        header: {
          ...parsedVehicleList.header,
          numVehicles: updatedVehicles.length
        }
      });
    }
    setIsModified(true);
  };
  const handleExportBundle = () => {
    navigate('/export');
  };

  return (
    <VehicleList
      vehicles={vehicleList}
      onAddVehicle={handleAddVehicle}
      onEditVehicle={handleEditVehicle}
      onDeleteVehicle={handleDeleteVehicle}
      onExportBundle={handleExportBundle}
    />
  );
};

export default VehiclesPage;


