import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { mapboxConfig } from '@config/mapbox.config';

@Injectable()
export class MapboxService {
  private readonly logger = new Logger(MapboxService.name);

  constructor(@Inject(mapboxConfig.KEY) private readonly cfg: ConfigType<typeof mapboxConfig>) {
    if (!this.cfg.accessToken) {
      this.logger.warn('Mapbox access token not set; geocoding disabled.');
    }
  }

  isReady(): boolean {
    return Boolean(this.cfg.accessToken);
  }

  /**
   * Forward geocoding stub. Real implementation lands with the Geo module.
   */
  async forwardGeocode(_query: string): Promise<{ latitude: number; longitude: number } | null> {
    if (!this.isReady()) {
      return null;
    }
    return null;
  }
}
