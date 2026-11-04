import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ApprovalService } from './approval.service';
import type { ApprovalListResult } from './approval.types';

/**
 * Approval 模块 API（挂 /api/v1 前缀，路由为 /api/v1/approvals/*）。
 */
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  // GET /api/v1/approvals/:wallet?chainId=&token=&spender=
  @Get(':wallet')
  list(
    @Param('wallet') wallet: string,
    @Query('chainId') chainId?: string,
    @Query('token') token?: string,
    @Query('spender') spender?: string,
  ): Promise<ApprovalListResult> {
    if (!wallet || wallet.trim().length === 0) {
      throw new BadRequestException('approvals 需要非空的 wallet 路径参数');
    }
    return this.approvalService.getApprovals({
      wallet: wallet.trim(),
      chainId: this.parseOptionalInt(chainId, 'chainId'),
      token: token?.trim() || undefined,
      spender: spender?.trim() || undefined,
    });
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
