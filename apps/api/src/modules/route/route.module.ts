import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';

/**
 * 路由引擎模块（Sprint 5）。
 * 依赖 DexModule（DexPoolService：池发现 + 逐池报价）。
 * PrismaModule / ChainModule 均为 @Global，无需重复导入。
 */
@Module({
  imports: [DexModule],
  controllers: [RouteController],
  providers: [RouteService],
})
export class RouteModule {}
