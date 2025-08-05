import { getStatBarColor } from '@/lib/burnoutTheme';

interface StatBarProps {
  value: number;
  max?: number;
  label: string;
  type?: 'speed' | 'strength' | 'default';
}

export const StatBar = ({ value, max = 10, label, type = "default" }: StatBarProps) => {
  const percentage = Math.min((value / max) * 100, 100);
  const barColor = getStatBarColor(type);
  
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-muted-foreground">{label}:</span>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono">{value}</span>
    </div>
  );
}; 