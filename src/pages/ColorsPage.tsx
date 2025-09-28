import { useBundle } from '@/context/BundleContext';
import { PlayerCarColoursComponent } from '@/components/PlayerCarColours';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

const ColorsPage = () => {
  const { playerCarColours } = useBundle();
  if (!playerCarColours) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No player car colours found in this bundle.</AlertDescription>
      </Alert>
    );
  }
  return <PlayerCarColoursComponent colours={playerCarColours} />;
};

export default ColorsPage;


