import { Module } from '@nestjs/common';

import { OnboardingService } from './onboarding/onboarding.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, OnboardingService],
  exports: [UsersService, OnboardingService],
})
export class UsersModule {}
