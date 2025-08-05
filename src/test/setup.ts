// Test setup file for vitest
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Global test setup
beforeAll(() => {
  // Setup code that runs before all tests
  console.log('🧪 Starting Paradise Bundle Steward test suite...');
});

afterAll(() => {
  // Cleanup code that runs after all tests
  console.log('✅ Test suite completed!');
});

beforeEach(() => {
  // Setup code that runs before each test
});

afterEach(() => {
  // Cleanup code that runs after each test
});

// Mock console methods to reduce noise in tests
const originalConsoleDebug = console.debug;
const originalConsoleLog = console.log;

// Override console methods during tests to reduce noise
console.debug = (...args: unknown[]) => {
  if (process.env.VITEST_DEBUG) {
    originalConsoleDebug(...args);
  }
};

// Allow important logs to show
console.log = (...args: unknown[]) => {
  if (process.env.VITEST_DEBUG || args.some(arg => 
    typeof arg === 'string' && (
      arg.includes('✅') || 
      arg.includes('❌') || 
      arg.includes('🧪') ||
      arg.includes('Test')
    )
  )) {
    originalConsoleLog(...args);
  }
};

// Export utilities for tests
export const testUtils = {
  enableDebug: () => {
    console.debug = originalConsoleDebug;
    console.log = originalConsoleLog;
  },
  disableDebug: () => {
    console.debug = () => {};
    console.log = () => {};
  }
}; 