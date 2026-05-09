import { Controller, ControllerOptions } from '@nestjs/common';

/**
 * Convenience wrapper around @Controller that prefixes the path with the
 * configured API version. Use as `@ApiV1Controller('users')`.
 */
export const ApiV1Controller = (path?: string | string[], options?: ControllerOptions) => {
  const paths = Array.isArray(path) ? path : path ? [path] : [];
  const prefixed = paths.map((p) => p.replace(/^\//, ''));
  return Controller({
    ...options,
    path: prefixed.length > 0 ? prefixed : undefined,
    version: '1',
  });
};
