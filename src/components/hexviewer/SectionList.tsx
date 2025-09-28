import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { HexSection } from './types';

export type SectionListProps = {
  sections: HexSection[];
  onScrollToSection: (name: string) => void;
  onOpenInspector: (section: HexSection) => void;
};

export const SectionList: React.FC<SectionListProps> = ({ sections, onScrollToSection, onOpenInspector }) => {
  return (
    <div className="space-y-2">
      <Label>Sections</Label>
      <div className="flex flex-col gap-2">
        {sections.map(section => {
          const IconComponent = section.icon;
          return (
            <div key={section.name} className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onScrollToSection(section.name)} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded ${section.color}`} />
                <IconComponent className="w-4 h-4" />
                {section.name}
                <span className="text-xs text-muted-foreground">({(section.end - section.start).toLocaleString()} bytes)</span>
              </Button>
              {section.kind === 'resource' && (
                <Button variant="secondary" size="sm" onClick={() => onOpenInspector(section)}>Investigate</Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
