# Online Bundle Manager

A modern web-based tool for exploring and modifying Burnout Paradise bundle files. Built with React and TypeScript, Online Bundle Manager provides an intuitive interface for viewing and editing game resources including challenge lists, trigger data, vehicle lists, and more.

## Features

### Fully Supported (Read + Write + Edit)

- **Challenge List** - View and modify game challenges with a visual editor
  - Edit challenge properties, actions, and metadata
  - Modify difficulty, player requirements, and entitlements
  - Full read/write support with data validation

- **Trigger Data** - Complete editor for world trigger regions
  - Landmarks, generic regions, blackspots, and VFX regions
  - Spawn locations and roaming locations
  - Full read/write support with coordinate editing

### Read-Only Support

- **Vehicle List** - Browse all 284+ vehicles with detailed stats
  - Gameplay stats (speed, strength, boost capacity)
  - Audio configuration and category classification
  - Technical specifications and unlock requirements
  - ⚠️ Editor available but write support not yet working

- **Player Car Colours** - Explore color palettes
  - 5 palette types: Gloss, Metallic, Pearlescent, Special, Party
  - Paint and pearl color variations
  - Interactive color swatches with hex/RGB values
  - Support for "neon" colors (buffer overread exploit colors)
  - ⚠️ Write support not yet implemented

### Tools

- **Hex Viewer** - Low-level bundle inspection
  - Navigate bundle structure with visual coverage map
  - Inspect resource entries and raw data
  - Search by offset and view resource metadata
  - Color-coded sections by resource type

### Platform Support

- PC (32-bit)

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- Modern web browser with WebGL support

### Installation

```bash
git clone <repository-url>
cd online-bundle-manager
npm install
```

### Development

```bash
npm run dev
```

Open your browser to `http://localhost:5173` (or the port shown in terminal).

### Building

```bash
npm run build
```

## Usage

1. **Load a Bundle** - Click "Load Bundle File" and select a Burnout Paradise `.bundle` file
2. **Explore Resources** - Browse all resources in the bundle with the resource explorer
3. **Edit Supported Resources** - For Challenge List and Trigger Data, click to open the visual editor
4. **Make Changes** - Edit properties, add/remove entries, modify values
5. **Export Modified Bundle** - Save your changes to a new bundle file
6. **Inspect with Hex Viewer** - Use the hex viewer for low-level inspection of any resource

## Motivation

### Why This Project Exists

Online Bundle Manager was created to modernize the Burnout Paradise modding experience with three core goals:

1. **Modern Tech Stack** - Built with React and TypeScript, technologies that enable rapid development and excellent developer experience. Coming from a web development background, these tools are natural and productive.

2. **Better UX** - React makes it dramatically easier to create intuitive, responsive interfaces compared to traditional C# Windows Forms (used by the original Bundle Manager). Modern web UI patterns provide a superior user experience.

3. **AI-Assisted Development** - The combination of TypeScript and React is exceptionally well-suited for AI-assisted coding. The goal is to "vibe code" through Burnout Wiki specifications in about an hour per feature. This is a passion project, and the thesis is that AI-assisted development makes it feasible to implement game specs quickly and accurately—something that's already working well today and will only get better.

### Development Workflow

- **UI Development**: [Lovable](https://lovable.dev) for rapid UI prototyping and hosting
- **Logic Implementation**: Cursor AI for implementing parsers, editors, and business logic
- **Specifications**: [Burnout Wiki](https://burnout.wiki) as the authoritative source

### What Works Well

- **UI with Proper Types** - When data types are correctly defined, React components practically write themselves
- **Spec Coding** - AI assistance is good but not perfect. You still need to deeply understand the specification and catch bugs, even when referencing existing C# implementations from Bundle Manager.

## Roadmap / TODO

### Short Term

- [ ] **VehicleList Write Support** - Currently only read-only; writing needs debugging
- [ ] **PlayerCarColours Write Support** - Parser works, but serialization not yet implemented

### Blocked

- [ ] **ICE Take Dictionary** - Implementation blocked due to missing/incomplete specification on Burnout Wiki

### Long Term

- [ ] Additional resource type parsers (based on community needs)
- [ ] Resource diffing and comparison tools

## Technical Details

### Architecture

Built with modern web technologies:
- **React 18** - UI framework
- **TypeScript 5** - Type-safe development
- **Vite** - Fast build tooling
- **shadcn/ui** - Beautiful, accessible component library
- **Tailwind CSS** - Utility-first styling
- **typed-binary** - Binary data parsing

### Bundle Format

- Supports both standalone and nested bundle formats
- Automatic decompression of zlib-compressed data
- Resource entries with metadata (flags, memory type, compression info)

### Parser Architecture

Each resource type has three components:
1. **Parser** (`parse*Data`) - Converts binary data to structured objects
2. **Writer** (`write*Data`) - Serializes structured objects back to binary
3. **Editor UI** - React components for visual editing

See [`src/lib/capabilities.ts`](src/lib/capabilities.ts) for current implementation status of each resource type.

## Contributing

Contributions are welcome! This codebase is designed to be AI-friendly for rapid feature development.

### Adding a New Resource Parser

1. Check [Burnout Wiki](https://burnout.wiki) for the resource specification
2. Create parser in `src/lib/core/[resourceType].ts`
3. Implement reader and writer functions
4. Add types to `src/lib/core/types.ts`
5. Create editor UI in `src/pages/[ResourceType]Page.tsx`
6. Update `src/lib/capabilities.ts` with feature status

### Areas for Contribution

- Additional resource type parsers
- UI/UX improvements
- Bug fixes and optimizations
- Documentation updates
- Test coverage

## License

This project is for educational and research purposes. Burnout Paradise is a trademark of Electronic Arts Inc.

## Resources

- [Burnout Wiki](https://burnout.wiki) - Comprehensive documentation of game formats
- [Original Bundle Manager](https://github.com/burninrubber0/Bundle-Manager) - C# implementation by the community

## Acknowledgments

- The Burnout modding community for reverse-engineering the game formats
- Burnout Wiki contributors for documenting specifications
- Original Bundle Manager developers for pioneering the tooling
