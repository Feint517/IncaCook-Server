import { Body, Controller, Put } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { DriversService } from './drivers.service';
import { UpsertDriverVehicleDto } from './dto/upsert-vehicle.dto';
import { UpsertDriverZonesDto } from './dto/upsert-zones.dto';

@Controller({ path: 'drivers/me', version: '1' })
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Put('vehicle')
  upsertVehicle(@CurrentUser() jwtUser: AuthenticatedUser, @Body() dto: UpsertDriverVehicleDto) {
    return this.drivers.upsertVehicle(jwtUser.id, dto);
  }

  @Put('zones')
  upsertZones(@CurrentUser() jwtUser: AuthenticatedUser, @Body() dto: UpsertDriverZonesDto) {
    return this.drivers.upsertZones(jwtUser.id, dto);
  }
}
