import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SplitService } from './split.service';
import type {
  SplitOrderDetailDto,
  SplitPrepareRequestDto,
  SplitPrepareResponseDto,
  SubmitSplitChildRequestDto,
  SubmitSplitChildResponseDto,
} from './split.types';

/**
 * 拆单路由 API（挂 /api/v1 前缀，路由为 /api/v1/swaps/split）。
 * - POST /api/v1/swaps/split/prepare            ：大额订单拆分为 N 子单（含各自 calldata + 聚合授权）
 * - POST /api/v1/swaps/split/:splitOrderId/submit-child ：回写单条子单广播结果
 * - GET  /api/v1/swaps/split/:splitOrderId      ：母单详情 + 子单进度
 *
 * 非托管：prepare 只产出 calldata；submit-child 只收公开 tx_hash。
 */
@Controller('swaps/split')
export class SplitController {
  constructor(private readonly splitService: SplitService) {}

  @Post('prepare')
  prepare(
    @Body() body: SplitPrepareRequestDto,
  ): Promise<SplitPrepareResponseDto> {
    return this.splitService.prepareSplit(body);
  }

  @Post(':splitOrderId/submit-child')
  submitChild(
    @Param('splitOrderId') splitOrderId: string,
    @Body() body: SubmitSplitChildRequestDto,
  ): Promise<SubmitSplitChildResponseDto> {
    return this.splitService.submitChild(splitOrderId, body);
  }

  @Get(':splitOrderId')
  detail(@Param('splitOrderId') splitOrderId: string): Promise<SplitOrderDetailDto> {
    return this.splitService.getSplitOrder(splitOrderId);
  }
}
