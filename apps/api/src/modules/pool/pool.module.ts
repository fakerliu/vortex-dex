import { Module } from '@nestjs/common';
import { PoolController } from './pool.controller';
import { PoolService } from './pool.service';

/**
 * Pool 模块（Sprint 6 Pool Explorer）。
 *
 * 只读聚合，仅依赖 PrismaService（@Global，无需重复导入）。
 * 不发 RPC、不触发池子发现 —— 池数据由报价/路由引擎在真实交易时落库。
 */
@Module({
  controllers: [PoolController],
  providers: [PoolService],
  exports: [PoolService],
})
export class PoolModule {}
