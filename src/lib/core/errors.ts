// Error classes for bundle operations

export class BundleError extends Error {
  constructor(message: string, public code?: string, public details?: unknown) {
    super(message);
    this.name = 'BundleError';
  }
}

export class ResourceNotFoundError extends BundleError {
  constructor(resourceTypeId: number) {
    super(`Resource type 0x${resourceTypeId.toString(16)} not found`, 'RESOURCE_NOT_FOUND', { resourceTypeId });
  }
}

export class CompressionError extends BundleError {
  constructor(message: string, details?: unknown) {
    super(`Compression error: ${message}`, 'COMPRESSION_ERROR', details);
  }
}

export class ValidationError extends BundleError {
  constructor(message: string, details?: unknown) {
    super(`Validation error: ${message}`, 'VALIDATION_ERROR', details);
  }
}
