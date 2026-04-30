import { useFirstLoadedBundle } from '@/context/WorkspaceContext';
import { HexViewer } from '@/components/hexviewer/HexViewer';

const HexViewPage = () => {
  const activeBundle = useFirstLoadedBundle();
  return (
    <HexViewer
      originalData={activeBundle?.originalArrayBuffer ?? null}
      bundle={activeBundle?.parsed ?? null}
      isModified={activeBundle?.isModified ?? false}
      resources={activeBundle?.resources ?? []}
    />
  );
};

export default HexViewPage;


