import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Eye, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getCapabilityByTypeId, type FeatureCapability } from '@/lib/capabilities';

type CapabilityBadgeProps = {
  resourceTypeId: number;
  variant?: 'default' | 'compact';
}

export const CapabilityBadge = ({ resourceTypeId, variant = 'default' }: CapabilityBadgeProps) => {
  const capability = getCapabilityByTypeId(resourceTypeId);

  if (!capability) {
    return null;
  }

  const getStatus = (cap: FeatureCapability) => {
    // Check if any capability is partial
    const hasPartial = cap.read === "partial" || cap.write === "partial" || cap.editor === "partial";
    
    // Full support: all three must be explicitly true
    if (cap.read === true && cap.write === true && cap.editor === true) {
      return {
        label: 'Full Support',
        icon: CheckCircle2,
        color: 'bg-green-500/20 text-green-700 border-green-300 dark:bg-green-500/20 dark:text-green-400 dark:border-green-800',
        description: 'Read, write, and edit support'
      };
    }
    
    // Read-only: can read and edit, but not write
    if ((cap.read === true || cap.read === "partial") && cap.editor && cap.write === false) {
      return {
        label: 'Read-Only',
        icon: Eye,
        color: 'bg-amber-500/20 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-800',
        description: 'Can view and browse, but cannot save changes'
      };
    }
    
    // Partial support: some features work but not all
    if (hasPartial) {
      return {
        label: 'Partial',
        icon: AlertCircle,
        color: 'bg-blue-500/20 text-blue-700 border-blue-300 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800',
        description: 'Partial support - some features may not work correctly'
      };
    }
    
    // Not supported: nothing works
    if (!cap.read && !cap.write && !cap.editor) {
      return {
        label: 'Not Supported',
        icon: AlertCircle,
        color: 'bg-red-500/20 text-red-700 border-red-300 dark:bg-red-500/20 dark:text-red-400 dark:border-red-800',
        description: 'Not yet implemented'
      };
    }
    
    // Fallback for any other combination
    return {
      label: 'Limited',
      icon: AlertCircle,
      color: 'bg-blue-500/20 text-blue-700 border-blue-300 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800',
      description: 'Limited support available'
    };
  };

  const status = getStatus(capability);
  const Icon = status.icon;

  if (variant === 'compact') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`text-xs ${status.color}`}>
              <Icon className="w-3 h-3 mr-1" />
              {status.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1">
              <p className="font-medium">{capability.name}</p>
              <p className="text-sm">{status.description}</p>
              {capability.notes && (
                <p className="text-xs text-muted-foreground">{capability.notes}</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Badge variant="outline" className={`text-xs ${status.color}`}>
      <Icon className="w-3 h-3 mr-1" />
      {status.label}
    </Badge>
  );
};

