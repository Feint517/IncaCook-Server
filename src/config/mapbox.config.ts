import { registerAs } from '@nestjs/config';

export const mapboxConfig = registerAs('mapbox', () => ({
  accessToken: process.env.MAPBOX_ACCESS_TOKEN ?? '',
}));

export type MapboxConfig = ReturnType<typeof mapboxConfig>;
