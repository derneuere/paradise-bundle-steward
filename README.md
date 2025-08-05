# Paradise Bundle Steward 🏎️

A modern web-based tool for managing and exploring Burnout Paradise game bundles and vehicle data. Built as a companion to the [Bundle Manager](https://github.com/burninrubber0/Bundle-Manager) desktop application, Paradise Bundle Steward provides an intuitive web interface for analyzing game assets, vehicle specifications, and bundle contents.

**✨ Now powered by [typed-binary](https://github.com/iwoplaza/typed-binary) for type-safe, schema-validated binary parsing!**

## 🎯 Features

### Bundle Management
- **Bundle Parsing**: Load and analyze Burnout Paradise bundle files with full type safety
- **Resource Explorer**: Browse game resources with detailed metadata
- **Multi-Platform Support**: Compatible with PC, Xbox 360, and PS3 bundle formats
- **Memory Analysis**: View memory distribution and resource sizing information
- **Nested Bundle Support**: Automatic detection and extraction of nested bundles
- **Automatic Decompression**: Built-in zlib decompression using pako

### Vehicle Data Analysis
- **Complete Vehicle Database**: Parse and display all 500+ vehicles from VEHICLELIST.BUNDLE
- **Vehicle Specifications**: Speed stats, boost types, strength ratings, and classifications
- **Audio & Visual Data**: Engine sounds, exhaust effects, and visual customization options
- **Category Classification**: Organize by Paradise Cars, Bikes, Legendary Cars, DLC content, etc.
- **Manufacturer Information**: Full vehicle manufacturer and naming data
- **Gameplay Attributes**: Damage limits, boost capacity, unlocking requirements

### Advanced Features
- **Type-Safe Parsing**: Schema-validated binary parsing with TypeScript intellisense
- **Debug Data Extraction**: Access resource string tables and development metadata  
- **Cross-Platform Compatibility**: Handle different endianness and platform-specific formats
- **Modern Web Interface**: Built with React, TypeScript, and Tailwind CSS
- **Responsive Design**: Optimized for desktop and mobile viewing

## 🔧 Technical Implementation

### Binary Parsing Engine
- **typed-binary Schemas**: Declarative, type-safe binary data structures
- **Automatic Endianness Detection**: Smart handling of little/big-endian data
- **Schema Validation**: Runtime validation of binary data integrity
- **64-bit Integer Support**: Custom handling for game entity IDs and keys
- **Error Recovery**: Graceful handling of corrupted or incomplete data

### Supported Data Formats
- **Bundle 2 Format**: Full support for Burnout Paradise's bundle architecture
- **Vehicle List Data**: Complete parsing of vehicle specifications and metadata
- **Compressed Resources**: Automatic zlib decompression for nested content
- **Debug Information**: Resource string tables and development annotations
- **Cross-Platform Assets**: PC, Xbox 360, and PlayStation 3 bundle variants

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or bun package manager

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd paradise-bundle-steward

# Install dependencies
npm install

# Start development server
npm run dev
```

### Usage
1. **Load Bundle Files**: Drag and drop VEHICLELIST.BUNDLE or other bundle files
2. **Explore Resources**: Browse the automatically parsed resource tree
3. **Analyze Vehicles**: View detailed specifications for Paradise vehicles
4. **Export Data**: Download parsed data in JSON format for external use

## 📊 Data Sources & References

This tool is built according to the official specifications and references:

- **[Burnout Paradise Vehicle List](https://burnout.wiki/wiki/Vehicle_List/Burnout_Paradise)** - Complete vehicle database and specifications
- **[Bundle Manager](https://github.com/burninrubber0/Bundle-Manager)** - Reference implementation for bundle parsing
- **[Burnout Modding Wiki](https://burnout.wiki/)** - Comprehensive modding documentation and data formats

## 🛠️ Technology Stack

### Core Technologies
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe JavaScript with modern language features
- **[React 18](https://reactjs.org/)** - Component-based UI framework with hooks
- **[Vite](https://vitejs.dev/)** - Fast build tool and development server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework

### Binary Parsing & Data Processing
- **[typed-binary](https://github.com/iwoplaza/typed-binary)** - Type-safe binary data parsing with schema validation
- **[pako](https://github.com/nodeca/pako)** - Fast zlib compression/decompression library
- **Custom Schemas** - Tailored binary data structures for Burnout Paradise formats

### UI Components & Styling
- **[shadcn/ui](https://ui.shadcn.com/)** - High-quality, customizable React components
- **[Lucide React](https://lucide.dev/)** - Beautiful, consistent icon library
- **[Recharts](https://recharts.org/)** - Composable charting library for data visualization

## 📁 Project Structure

```
src/
├── components/           # React components
│   ├── ui/              # Base UI components (shadcn/ui)
│   ├── BundleManager.tsx # Main bundle management interface
│   └── VehicleList.tsx  # Vehicle data display and analysis
├── lib/                 # Core libraries and utilities
│   ├── bundleParser.ts  # typed-binary bundle format parser
│   ├── vehicleListParser.ts # Vehicle list data structures and parsing
│   ├── resourceTypes.ts # Game resource type definitions
│   └── utils.ts         # Utility functions and helpers
├── pages/               # Application pages and routing
└── hooks/               # Custom React hooks
```

## 🧪 Testing & Validation

The parsers are thoroughly tested against real Burnout Paradise bundle files:

```bash
# Run parser tests with example data
npm run test-parser

# Test specific bundle formats
npx tsx test-parser.ts
```

**Test Results:**
- ✅ Successfully parses 500+ vehicle entries from VEHICLELIST.BUNDLE
- ✅ Handles nested bundles with automatic decompression  
- ✅ Validates data integrity against Bundle Manager reference implementation
- ✅ Supports all platform variants (PC, Xbox 360, PS3)

## 🤝 Contributing

We welcome contributions to improve Paradise Bundle Steward! Please see our contributing guidelines and feel free to:

- Report bugs or suggest features via GitHub Issues
- Submit pull requests with improvements or fixes  
- Help improve documentation and examples
- Share bundle files for testing (following appropriate licensing)

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Burnout Paradise Modding Community** - For reverse engineering the bundle formats
- **[iwoplaza](https://github.com/iwoplaza)** - For the excellent typed-binary library
- **Criterion Games** - For creating the incredible Burnout Paradise
- **Bundle Manager Contributors** - For the reference implementation and documentation

---

**Paradise Bundle Steward** - Making Burnout Paradise modding more accessible through modern web technology! 🏁
