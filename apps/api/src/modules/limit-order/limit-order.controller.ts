import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { LimitOrderService } from './limit-order.service';
import { LimitOrderKeeperService } from './limit-order-keeper.service';
import type {
  CreateLimitOrderRequestDto,
  CreateLimitOrderResponseDto,
  KeeperRunResultDto,
  LimitOrderDto,
  LimitOrderListResultDto,
  SubmitSignatureRequestDto,
} from './limit-order.types';

/**
 * 限价单 API（挂 /api/v1 前缀，路由为 /api/v1/limit-orders）。
 * - POST /api/v1/limit-orders                    ：下单，返回 order + signingPayload
 * - POST /api/v1/limit-orders/:id/signature      ：提交签名，武装订单
 * - GET  /api/v1/limit-orders?user=&status=      ：列表
 * - GET  /api/v1/limit-orders/:id                ：详情
 * - POST /api/v1/limit-orders/:id/cancel         ：撤单（CAS + 属主校验）
 * - POST /api/v1/limit-orders/keeper/run         ：手动触发 keeper 一轮（幂等）
 */
@Controller('limit-orders')
export class LimitOrderController {
  constructor(
    private readonly limitOrderService: LimitOrderService,
    private readonly keeperService: LimitOrderKeeperService,
  ) {}

  @Post()
  create(
    @Body() body: CreateLimitOrderRequestDto,
  ): Promise<CreateLimitOrderResponseDto> {
    return this.limitOrderService.createOrder(body);
  }

  @Post(':id/signature')
  submitSignature(
    @Param('id') id: string,
    @Body() body: SubmitSignatureRequestDto,
  ): Promise<LimitOrderDto> {
    return this.limitOrderService.submitSignature(id, body);
  }

  @Get()
  list(
    @Query('user') user?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<LimitOrderListResultDto> {
    return this.limitOrderService.listOrders({
      user: user ?? '',
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<LimitOrderDto> {
    return this.limitOrderService.getOrder(id);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() body: { userAddress: string },
  ): Promise<LimitOrderDto> {
    return this.limitOrderService.cancelOrder(id, body?.userAddress ?? '');
  }

  @Post('keeper/run')
  runKeeper(): Promise<KeeperRunResultDto> {
    return this.keeperService.runCycle();
  }
}
