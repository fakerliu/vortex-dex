import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';

/**
 * 问题诊断 API（Analytics 第九步），路由 /api/v1/analytics/diagnosis/*。
 * - GET /diagnosis/intents/:intentId ：交易级全链路追踪（intent_id 串联）
 * - GET /diagnosis/intents           ：意图列表（按状态筛选）
 * - GET /diagnosis/failures          ：失败交易列表
 */
@Controller('analytics/diagnosis')
export class DiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}

  @Get('intents/:intentId')
  traceIntent(@Param('intentId') intentId: string) {
    return this.diagnosis.traceIntent(intentId);
  }

  @Get('intents')
  listIntents(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.diagnosis.listIntents(
      status,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Get('failures')
  listFailures(@Query('limit') limit?: string) {
    return this.diagnosis.listFailures(
      limit !== undefined ? Number(limit) : undefined,
    );
  }
}
