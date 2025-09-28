import { useBundle } from '@/context/BundleContext';
import { HexViewer } from '@/components/hexviewer/HexViewer';

const HexViewPage = () => {
  const { originalArrayBuffer, loadedBundle, resources, isModified } = useBundle();
  return (
    <HexViewer
      originalData={originalArrayBuffer}
      bundle={loadedBundle}
      isModified={isModified}
      resources={resources}
    />
  );
};

export default HexViewPage;


