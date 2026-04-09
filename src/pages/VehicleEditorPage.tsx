import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { VehicleEditor } from '@/components/VehicleEditor';
import { useBundle } from '@/context/BundleContext';
import type { VehicleListEntry, ParsedVehicleList } from '@/lib/core/vehicleList';

const VehicleEditorPage = () => {
  const navigate = useNavigate();
  const params = useParams();
  const idParam = params.id;
  const isNew = idParam === 'new';
  const { getResource, setResource } = useBundle();
  const parsedVehicleList = getResource<ParsedVehicleList>('vehicleList');
  const vehicles: VehicleListEntry[] = parsedVehicleList?.vehicles ?? [];

  const vehicle = useMemo<VehicleListEntry | null>(() => {
    if (!idParam || idParam === 'new') return null;
    try {
      const id = BigInt(idParam);
      return vehicles.find((v) => v.id === id) || null;
    } catch {
      return null;
    }
  }, [vehicles, idParam]);

  const handleClose = () => navigate('/vehicleList');

  const handleSave = (saved: VehicleListEntry) => {
    if (!parsedVehicleList) return;
    let updated: VehicleListEntry[];
    if (isNew) {
      updated = [...vehicles, saved];
    } else {
      updated = vehicles.map((v) => (v.id === saved.id ? saved : v));
    }
    setResource('vehicleList', {
      ...parsedVehicleList,
      vehicles: updated,
      header: { ...parsedVehicleList.header, numVehicles: updated.length },
    });
    navigate('/vehicleList');
  };

  return (
    <VehicleEditor vehicle={vehicle} isOpen={true} onClose={handleClose} onSave={handleSave} isNewVehicle={isNew} />
  );
};

export default VehicleEditorPage;
