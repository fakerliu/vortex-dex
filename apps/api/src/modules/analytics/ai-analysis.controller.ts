import { Controller, Get, Param } from '@nestjs/common';
import { AiAnalysisService } from './ai-analysis.service';

/**
 * AI 分析 API（Analytics 第十步），路由 /api/v1/analytics/ai/*。
 * - GET /ai/summary              ：全局智能摘要（自然语言报告）
 * - GET /ai/diagnose/:intentId   ：单笔交易智能诊断
 */
@Controller('analytics/ai')
export class AiAnalysisController {
  constructor(private readonly ai: AiAnalysisService) {}

  @Get('summary')
  summary() {
    return this.ai.getSummary();
  }

  @Get('diagnose/:intentId')
  diagnose(@Param('intentId') intentId: string) {
    return this.ai.diagnoseIntent(intentId);
  }
}
