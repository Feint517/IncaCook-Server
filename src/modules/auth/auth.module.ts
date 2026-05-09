import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

import { supabaseConfig } from '@config/supabase.config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';

@Module({
  imports: [
    ConfigModule.forFeature(supabaseConfig),
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SupabaseJwtStrategy],
  exports: [AuthService, PassportModule],
})
export class AuthModule {}
