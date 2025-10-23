import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';
import type { FeatureCapability } from '@/lib/capabilities';

type ExportWarningModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  unsupportedFeatures: FeatureCapability[];
}

export const ExportWarningModal = ({
  open,
  onOpenChange,
  onConfirm,
  unsupportedFeatures
}: ExportWarningModalProps) => {
  if (unsupportedFeatures.length === 0) {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Exporting with Limited Support Features
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              You've modified resources that don't have full write support yet. 
              These changes <strong>may break</strong> the exported bundle or have errors when saving changes back to the bundle file.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {unsupportedFeatures.map((feature) => {
                const hasPartial = feature.read === "partial" || feature.write === "partial" || feature.editor === "partial";
                const supportLevel = hasPartial ? "(Partial Support)" : "(Read-Only)";
                return (
                  <li key={feature.id}>
                    <strong>{feature.name}</strong> {supportLevel} - {feature.notes || "Limited write support"}
                  </li>
                );
              })}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Export Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

