import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketRankingService } from './market-ranking.service';
import type {
  MarketPriceDto,
  MarketSnapshotResult,
  RankingResult,
  RankingSortBy,
} from './market.types';

/**
 * Market 模块 API（挂 /api/v1 前缀，路由为 /api/v1/market/*）。
 * 供 Explore（市场发现）与 Token Detail 消费，所有返回字段均带 authenticity。
 */
@Controller('market')
export class MarketController {
  constructor(
    private readonly marketService: MarketService,
    private readonly rankingService: MarketRankingService,
  ) {}

  // GET /api/v1/market/price?chainId=&token=
  @Get('price')
  price(
    @Query('chainId') chainId?: string,
    @Query('token') token?: string,
  ): Promise<MarketPriceDto> {
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('price 需要非空的 token 参数');
    }
    return this.marketService.getTokenPrice(
      this.parseOptionalInt(chainId, 'chainId'),
      token.trim(),
    );
  }

  // GET /api/v1/market/snapshot?chainId=
  @Get('snapshot')
  snapshot(
    @Query('chainId') chainId?: string,
  ): Promise<MarketSnapshotResult> {
    return this.marketService.getMarketSnapshot(
      this.parseOptionalInt(chainId, 'chainId'),
    );
  }

  // GET /api/v1/market/ranking?chainId=&sortBy=&limit=
  @Get('ranking')
  ranking(
    @Query('chainId') chainId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('limit') limit?: string,
  ): Promise<RankingResult> {
    return this.rankingService.getRanking(
      this.parseOptionalInt(chainId, 'chainId'),
      this.parseSortBy(sortBy),
      this.parseOptionalInt(limit, 'limit'),
    );
  }

  // ---------- 私有工具 ----------

  private parseSortBy(sortBy?: string): RankingSortBy | undefined {
    if (sortBy === undefined || sortBy === '') {
      return undefined;
    }
    if (sortBy === 'volume' || sortBy === 'price_change') {
      return sortBy;
    }
    throw new BadRequestException(
      `不支持的 sortBy: ${sortBy}（支持 volume / price_change）`,
    );
  }

  private parseOptionalInt(
    value: string | undefined,
    name: string,
  ): number | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new BadRequestException(`参数 ${name} 必须是整数`);
    }
    return n;
  }
}
