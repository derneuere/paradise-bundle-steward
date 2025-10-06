# Paradise Bundle Steward

A web-based tool for exploring and managing Burnout Paradise bundle files, providing detailed insights into game resources including vehicle lists, player car colours, and more.

## Features

- 🎮 **Bundle File Parsing**: Load and explore Burnout Paradise .bundle files
- 🚗 **Vehicle List Viewer**: Browse all vehicles with detailed stats, gameplay data, and technical specifications
- 🎨 **Player Car Colours**: View and explore car color palettes including paint and pearl colors
- 🔍 **Resource Explorer**: Search and filter through all bundle resources
- 📊 **Platform Support**: Handles PC, PS3, and Xbox 360 bundle formats
- 🔧 **Debug Information**: Displays resource names and metadata when available

## Supported Resource Types

### Vehicle List (0x10005)
- Complete vehicle database with 284+ vehicles
- Gameplay stats (speed, strength, boost capacity)
- Audio configuration (engine sounds, exhaust, music)
- Category classification (Paradise Cars, Bikes, Legendary, etc.)
- Technical specifications and unlock requirements

### Player Car Colours (0x1001E)
- 5 color palette types: Gloss, Metallic, Pearlescent, Special, and Party
- Paint and pearl color variations
- Support for "neon" colors (buffer overread exploit colors)
- Both 32-bit and 64-bit architecture support
- Interactive color swatches with hex/RGB values

### Additional Resources
- Textures, Materials, Models, Audio, and more
- Debug information and resource metadata
- Platform-specific memory layout details

## Getting Started

### Prerequisites
- Node.js 20+ and npm
- Modern web browser with WebGL support

### Installation
```bash
git clone <repository-url>
cd paradise-bundle-steward
npm install
```

### Development
```bash
npm run dev
```

### Building
```bash
npm run build
```

## Usage

1. **Load a Bundle**: Click "Load Bundle File" and select a Burnout Paradise .bundle file
2. **Explore Vehicles**: If the bundle contains a Vehicle List, browse through all vehicles with detailed information
3. **View Colors**: If Player Car Colours are present, explore the different color palettes available
4. **Search Resources**: Use the Resource Explorer to find specific resources by name, type, or ID
5. **Platform Detection**: The tool automatically detects the platform (PC/PS3/Xbox) and adjusts parsing accordingly

## Technical Details

### Architecture Support
- **32-bit**: Original console versions (PS3, Xbox 360)
- **64-bit**: PC version with extended memory layout

### Color System
- Colors stored as Vector4 (RGBA) with float values representing percentages of 255
- Support for "neon" colors that exceed normal RGB ranges (exploits)
- Automatic detection of buffer overread colors

### Bundle Format
- Supports both standalone and nested bundle formats
- Automatic decompression of zlib-compressed data
- Platform-specific endianness handling

## Implementation Details

The PlayerCarColours parser follows the specifications from [Burnout Wiki](https://burnout.wiki/wiki/Player_Car_Colours):

```typescript
// 5 Palette Types
enum PaletteType {
  GLOSS = 0,      // Standard gloss finish
  METALLIC = 1,   // Metallic paint
  PEARLESCENT = 2, // Pearl finish
  SPECIAL = 3,    // Special colors
  PARTY = 4       // Party/event colors
}

// Color Structure
interface PlayerCarColor {
  red: number;     // 0.0 - 1.0+ (neon colors can exceed 1.0)
  green: number;
  blue: number;
  alpha: number;
  hexValue: string;  // #RRGGBB format
  rgbValue: string;  // rgb(r, g, b) format
  isNeon: boolean;   // Values > 1.0 create neon effects
}
```

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for:
- Additional resource type parsers
- UI/UX improvements
- Bug fixes and optimizations
- Documentation updates

## License

This project is for educational and research purposes. Burnout Paradise is a trademark of Electronic Arts Inc.
