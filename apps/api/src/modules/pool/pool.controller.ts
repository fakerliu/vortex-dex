import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { PoolService } from './pool.service';
import type { PoolDetailDto, PoolListResult } from './pool.types';

/**
 * Pool 流动性池模块 API（挂 /api/v1 前缀，路由为 /api/v1/pools/*）。
 * 供 Pool Explorer 消费：真实流动性池列表 + 详情（含历史快照）。
 */
@Controller('pools')
export class PoolController {
  constructor(private readonly poolService: PoolService) {}

  // GET /api/v1/pools?chainId=&token0=&token1=&page=&limit=
  @Get()
  list(
    @Query('chainId') chainId?: string,
    @Query('token0') token0?: string,
    @Query('token1') token1?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PoolListResult> {
    return this.poolService.list({
      chainId: this.parseOptionalInt(chainId, 'chainId'),
      token0,
      token1,
      page: this.parseOptionalInt(page, 'page'),
      limit: this.parseOptionalInt(limit, 'limit'),
    });
  }

  // GET /api/v1/pools/:id
  @Get(':id')
  detail(@Param('id') id: string): Promise<PoolDetailDto> {
    return this.poolService.detail(id);
  }

  // ---------- 私有工具 ----------

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
