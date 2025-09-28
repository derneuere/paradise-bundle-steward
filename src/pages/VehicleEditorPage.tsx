import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { VehicleEditor } from '@/components/VehicleEditor';
import { useBundle } from '@/context/BundleContext';
import type { VehicleListEntry } from '@/lib/core/vehicleList';

const VehicleEditorPage = () => {
  const navigate = useNavigate();
  const params = useParams();
  const idParam = params.id;
  const isNew = idParam === 'new';
  const { vehicleList, setVehicleList, parsedVehicleList, setParsedVehicleList, setIsModified } = useBundle();

  const vehicle = useMemo<VehicleListEntry | null>(() => {
    if (!idParam || idParam === 'new') return null;
    try {
      const id = BigInt(idParam);
      return vehicleList.find(v => v.id === id) || null;
    } catch {
      return null;
    }
  }, [vehicleList, idParam]);

  const handleClose = () => navigate('/vehicles');

  const handleSave = (saved: VehicleListEntry) => {
    let updated = vehicleList;
    if (isNew) {
      updated = [...vehicleList, saved];
    } else {
      updated = vehicleList.map(v => (v.id === saved.id ? saved : v));
    }
    setVehicleList(updated);
    if (parsedVehicleList) {
      setParsedVehicleList({
        ...parsedVehicleList,
        vehicles: updated,
        header: {
          ...parsedVehicleList.header,
          numVehicles: updated.length
        }
      });
    }
    setIsModified(true);
    navigate('/vehicles');
  };

  return (
    <VehicleEditor vehicle={vehicle} isOpen={true} onClose={handleClose} onSave={handleSave} isNewVehicle={isNew} />
  );
};

export default VehicleEditorPage;


