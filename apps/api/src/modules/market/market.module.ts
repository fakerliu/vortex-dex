import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { AlertsModule } from '../alerts/alerts.module';
import { MarketController } from './market.controller';
import { MarketRankingService } from './market-ranking.service';
import { MarketService } from './market.service';
import { PriceProviderService } from './price-provider.service';

/**
 * Market 模块（Sprint 2 Market Data Provider + Snapshot 落库 + Sprint 3 榜单）。
 *
 * 依赖：
 * - DexModule（export DexPoolService）：链上逐池报价，用于推导真实价格
 * - AlertsModule（export AlertsService）：快照落库后惰性触发价格提醒
 * - PrismaModule / ChainModule 均为 @Global，无需重复导入（PrismaService /
 *   ChainRpcService 直接注入）。
 *
 * MarketRankingService 只做只读聚合（价格快照 + Token 元数据 + Swap 成交量），
 * 仅依赖 PrismaService，无需 DexPoolService / ChainRpcService。
 */
@Module({
  imports: [DexModule, AlertsModule],
  controllers: [MarketController],
  providers: [MarketService, MarketRankingService, PriceProviderService],
  exports: [MarketService],
})
export class MarketModule {}
