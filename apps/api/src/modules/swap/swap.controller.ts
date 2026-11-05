import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SwapService } from './swap.service';
import type {
  PrepareSwapRequestDto,
  PrepareSwapResponseDto,
  SubmitSwapRequestDto,
  SwapDetailDto,
  SwapDto,
  SwapHistoryResult,
} from './swap.types';

/**
 * 交易执行 API（挂 /api/v1 前缀，路由为 /api/v1/swaps）。
 * - POST /api/v1/swaps/prepare：准备交易（报价 + 余额 + allowance + calldata）
 * - POST /api/v1/swaps/submit ：接收 tx_hash 写库（状态 PENDING）
 * - GET  /api/v1/swaps/history：按用户查历史
 * - GET  /api/v1/swaps/by-tx/:txHash：按 txHash 查单笔交易
 * - GET  /api/v1/swaps/:id    ：查单笔交易
 *
 * 非托管：prepare 只产出 calldata 供前端钱包签名广播；submit 只收公开 tx_hash。
 */
@Controller('swaps')
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  @Post('prepare')
  prepare(@Body() body: PrepareSwapRequestDto): Promise<PrepareSwapResponseDto> {
    return this.swapService.prepare(body);
  }

  @Post('submit')
  submit(@Body() body: SubmitSwapRequestDto): Promise<SwapDto> {
    return this.swapService.submit(body);
  }

  @Get('history')
  history(
    @Query('user') user: string,
    @Query('chainId') chainId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<SwapHistoryResult> {
    return this.swapService.getHistory(
      user,
      chainId !== undefined ? Number(chainId) : undefined,
      page !== undefined ? Number(page) : undefined,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Get('by-tx/:txHash')
  detailByTxHash(@Param('txHash') txHash: string): Promise<SwapDetailDto> {
    return this.swapService.getSwapByTxHash(txHash);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<SwapDetailDto> {
    return this.swapService.getSwap(id);
  }
}
