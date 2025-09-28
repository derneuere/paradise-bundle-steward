import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Hexagon, Search } from 'lucide-react';
import type { HexSection } from './types';

type ControlsProps = {
  isModified: boolean;
  sections: HexSection[];
  selectedSection: string;
  setSelectedSection: (val: string) => void;
  bytesPerRow: number;
  setBytesPerRow: (n: number) => void;
  searchOffset: string;
  setSearchOffset: (s: string) => void;
  onSearch: () => void;
};

export const Controls: React.FC<ControlsProps> = ({ isModified, sections, selectedSection, setSelectedSection, bytesPerRow, setBytesPerRow, searchOffset, setSearchOffset, onSearch }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hexagon className="w-5 h-5" />
          Hex Viewer
          {isModified && (
            <Badge variant="secondary" className="ml-2">Modified</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="section-select">Section</Label>
            <Select value={selectedSection} onValueChange={setSelectedSection}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {sections.map(section => (
                  <SelectItem key={section.name} value={section.name}>{section.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bytes-per-row">Bytes per Row</Label>
            <Select value={bytesPerRow.toString()} onValueChange={(value) => setBytesPerRow(parseInt(value))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8</SelectItem>
                <SelectItem value="16">16</SelectItem>
                <SelectItem value="32">32</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offset-search">Go to Offset (hex)</Label>
            <div className="flex gap-2">
              <Input id="offset-search" placeholder="0x00000000" value={searchOffset} onChange={(e) => setSearchOffset(e.target.value)} className="w-32 font-mono" />
              <Button onClick={onSearch} size="sm"><Search className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
