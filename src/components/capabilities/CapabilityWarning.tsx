import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Info } from 'lucide-react';
import { getCapability } from '@/lib/capabilities';

type CapabilityWarningProps = {
  featureId: string;
  variant?: 'warning' | 'info';
}

export const CapabilityWarning = ({ featureId, variant = 'warning' }: CapabilityWarningProps) => {
  const capability = getCapability(featureId);

  if (!capability) {
    return null;
  }

  // Only show warning if write is not fully supported
  if (capability.write === true) {
    return null;
  }

  const isWarning = variant === 'warning';
  const Icon = isWarning ? AlertTriangle : Info;
  
  // Determine the appropriate title and message based on support level
  let title: string;
  let defaultMessage: string;
  
  if (capability.read === "partial") {
    // Partial read support - specification is incomplete/missing
    title = "Partial Read Support";
    defaultMessage = `${capability.name} has incomplete specification. Only some of the data can be read and displayed. The full format specification is missing or incomplete on Burnout Wiki.`;
  } else if (capability.write === "partial") {
    // Partial write support
    title = "Partial Write Support";
    defaultMessage = `${capability.name} has partial write support. Saving changes may result in errors, data loss, or corrupted bundle files.`;
  } else if (capability.editor === "partial") {
    // Partial editor support
    title = "Partial Editor Support";
    defaultMessage = `${capability.name} has a partial editor. Some features may not be available or may not work correctly.`;
  } else {
    // Read-only (can read but not write)
    title = "Read-Only Mode";
    defaultMessage = `${capability.name} is currently in read-only mode. You can view and explore the data, but cannot save changes back to the bundle file.`;
  }

  return (
    <Alert variant={isWarning ? 'destructive' : 'default'} className="mb-4">
      <Icon className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {capability.notes || defaultMessage}
      </AlertDescription>
    </Alert>
  );
};

