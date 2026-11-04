import { Module } from '@nestjs/common';
import { AerodromeClassicAdapter } from './aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from './aerodrome/aerodrome-cl.adapter';
import { AerodromeService } from './aerodrome/aerodrome.service';
import { DexPoolService } from './dex-pool.service';
import { UniswapV3Adapter } from './uniswap-v3/uniswap-v3.adapter';
import { UniswapV3Service } from './uniswap-v3/uniswap-v3.service';

/**
 * DEX 协议 Adapter 模块（Sprint 3 接入 Aerodrome；新增 Uniswap V3 Sepolia）。
 *
 * - AerodromeClassicAdapter：classic（Velodrome v2 fork）恒定乘积 + stable 池
 * - AerodromeClAdapter：Slipstream 集中流动性 CL（Uniswap v3 fork）
 * - UniswapV3Adapter：Uniswap V3（Base Sepolia 84532）
 * - AerodromeService：Aerodrome 协议注册 + 池子落库
 * - UniswapV3Service：Uniswap V3 协议注册 + 池子落库
 * - DexPoolService：池发现 + 逐池报价（Quote/Route/Swap 复用，按链分派）
 *
 * 依赖 PrismaModule / ChainModule（均为 @Global），无需重复导入。
 */
@Module({
  providers: [
    AerodromeClassicAdapter,
    AerodromeClAdapter,
    UniswapV3Adapter,
    AerodromeService,
    UniswapV3Service,
    DexPoolService,
  ],
  exports: [
    AerodromeClassicAdapter,
    AerodromeClAdapter,
    UniswapV3Adapter,
    AerodromeService,
    UniswapV3Service,
    DexPoolService,
  ],
})
export class DexModule {}
