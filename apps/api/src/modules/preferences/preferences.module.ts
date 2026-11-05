import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

/**
 * 用户偏好模块（V1.2 Preferences）。
 *
 * PrismaModule / ChainModule 均为 @Global，无需重复导入（PrismaService 直接注入）。
 */
@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
