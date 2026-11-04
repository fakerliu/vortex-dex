import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AnomalyService } from './anomaly.service';

/**
 * 异常中心 API（Analytics 第八步），路由 /api/v1/analytics/anomaly/*。
 * - GET    /anomaly/rules       ：列出告警规则
 * - POST   /anomaly/rules       ：新增/更新规则
 * - POST   /anomaly/rules/:id/toggle ：启停规则
 * - DELETE /anomaly/rules/:id   ：删除规则
 * - POST   /anomaly/scan        ：执行一轮规则扫描
 * - POST   /anomaly/seed        ：初始化内置规则
 * - GET    /anomaly/events      ：查询异常事件
 * - POST   /anomaly/events/:id/resolve ：处理异常（ack/resolve）
 */
@Controller('analytics/anomaly')
export class AnomalyController {
  constructor(private readonly anomaly: AnomalyService) {}

  @Get('rules')
  rules() {
    return this.anomaly.listRules();
  }

  @Post('rules')
  upsertRule(
    @Body()
    body: {
      id?: string;
      name: string;
      metricName: string;
      operator: string;
      threshold: string;
      windowMinutes?: number;
      severity?: string;
      isEnabled?: boolean;
      description?: string;
    },
  ) {
    return this.anomaly.upsertRule(body);
  }

  @Post('rules/:id/toggle')
  toggleRule(
    @Param('id') id: string,
    @Body() body: { isEnabled: boolean },
  ) {
    return this.anomaly.toggleRule(id, body.isEnabled);
  }

  @Delete('rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.anomaly.deleteRule(id);
  }

  @Post('scan')
  scan() {
    return this.anomaly.scan();
  }

  @Post('seed')
  seed() {
    return this.anomaly.seedDefaultRules();
  }

  @Get('events')
  events(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
  ) {
    return this.anomaly.listAnomalies(
      status,
      severity,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Post('events/:id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() body: { status: 'acknowledged' | 'resolved' },
  ) {
    return this.anomaly.resolveAnomaly(id, body.status);
  }
}
