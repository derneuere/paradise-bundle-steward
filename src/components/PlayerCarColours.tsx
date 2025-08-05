import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Palette, Sparkles } from "lucide-react";
import type { PlayerCarColours, PlayerCarColourPalette, PlayerCarColor } from "@/lib/playerCarColoursParser";

interface PlayerCarColoursProps {
  colours: PlayerCarColours;
}

interface ColorSwatchProps {
  color: PlayerCarColor;
  isPearl?: boolean;
}

const ColorSwatch = ({ color, isPearl = false }: ColorSwatchProps) => {
  return (
    <div className="group relative">
      <div 
        className="w-8 h-8 rounded-md border-2 border-border cursor-pointer hover:scale-110 transition-transform shadow-sm"
        style={{ backgroundColor: color.rgbValue }}
        title={`${isPearl ? 'Pearl' : 'Paint'}: ${color.hexValue} ${color.isNeon ? '(Neon)' : ''}`}
      />
      {color.isNeon && (
        <div className="absolute -top-1 -right-1">
          <Sparkles className="w-3 h-3 text-yellow-400" />
        </div>
      )}
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
        <div className="font-mono">{color.hexValue}</div>
        <div className="text-muted-foreground">
          RGB({Math.round(color.red * 255)}, {Math.round(color.green * 255)}, {Math.round(color.blue * 255)})
        </div>
        {color.isNeon && <div className="text-yellow-400 text-xs">⚡ Neon</div>}
      </div>
    </div>
  );
};

interface PaletteCardProps {
  palette: PlayerCarColourPalette;
}

const PaletteCard = ({ palette }: PaletteCardProps) => {
  const maxColorsToShow = 20; // Limit display to prevent overwhelming UI
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            {palette.typeName}
          </div>
          <Badge variant="secondary">
            {palette.numColours} colors
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Paint Colors */}
        {palette.paintColours.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Paint Colors</h4>
            <div className="flex flex-wrap gap-2">
              {palette.paintColours.slice(0, maxColorsToShow).map((color, index) => (
                <ColorSwatch key={`paint-${index}`} color={color} />
              ))}
              {palette.paintColours.length > maxColorsToShow && (
                <div className="flex items-center justify-center w-8 h-8 rounded-md border-2 border-dashed border-muted-foreground/50 text-xs text-muted-foreground">
                  +{palette.paintColours.length - maxColorsToShow}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pearl Colors */}
        {palette.pearlColours.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Pearl Colors</h4>
            <div className="flex flex-wrap gap-2">
              {palette.pearlColours.slice(0, maxColorsToShow).map((color, index) => (
                <ColorSwatch key={`pearl-${index}`} color={color} isPearl />
              ))}
              {palette.pearlColours.length > maxColorsToShow && (
                <div className="flex items-center justify-center w-8 h-8 rounded-md border-2 border-dashed border-muted-foreground/50 text-xs text-muted-foreground">
                  +{palette.pearlColours.length - maxColorsToShow}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const PlayerCarColoursComponent = ({ colours }: PlayerCarColoursProps) => {
  if (!colours || colours.palettes.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-6 h-6" />
          Player Car Colours
          <Badge variant="outline" className="ml-auto">
            {colours.is64Bit ? '64-bit' : '32-bit'}
          </Badge>
        </CardTitle>
        <p className="text-muted-foreground">
          {colours.palettes.length} color palettes with {colours.totalColors} total colors
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
          {colours.palettes.map((palette) => (
            <PaletteCard key={palette.type} palette={palette} />
          ))}
        </div>
        
        {/* Information about neon colors */}
        <div className="bg-muted/50 rounded-lg p-4">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            About Neon Colors
          </h4>
          <p className="text-sm text-muted-foreground">
            Colors marked with ⚡ are "neon" colors that exceed normal RGB values, 
            creating extremely bright effects in-game. These are often the result of 
            buffer overread exploits in Burnout Paradise.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}; 