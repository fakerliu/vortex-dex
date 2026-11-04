import { Module } from '@nestjs/common';
import { AerodromeClassicAdapter } from './aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from './aerodrome/aerodrome-cl.adapter';
import { AerodromeService } from './aerodrome/aerodrome.service';
import { DexPoolService } from './dex-pool.service';

/**
 * DEX 协议 Adapter 模块（Sprint 3 接入 Aerodrome）。
 *
 * - AerodromeClassicAdapter：classic（Velodrome v2 fork）恒定乘积 + stable 池
 * - AerodromeClAdapter：Slipstream 集中流动性 CL（Uniswap v3 fork）
 * - AerodromeService：协议注册 + 池子落库
 * - DexPoolService：池发现 + 逐池报价（Quote/Route 复用）
 *
 * 依赖 PrismaModule / ChainModule（均为 @Global），无需重复导入。
 */
@Module({
  providers: [
    AerodromeClassicAdapter,
    AerodromeClAdapter,
    AerodromeService,
    DexPoolService,
  ],
  exports: [
    AerodromeClassicAdapter,
    AerodromeClAdapter,
    AerodromeService,
    DexPoolService,
  ],
})
export class DexModule {}
