import { Module } from '@nestjs/common';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';

/**
 * Approval 模块（MODULE 07 授权管理）。
 *
 * 依赖：ChainModule（@Global，导出 Erc20ReaderService）直接注入，
 * 无需重复导入。
 */
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
