import { Controller, Get, Query } from '@nestjs/common';
import { MonitorService } from './monitor.service';

/**
 * 系统监控 API（Analytics 第七步），路由 /api/v1/analytics/monitor/*。
 * - GET /monitor/health   ：实时健康检查（数据库/Indexer/错误率）
 * - GET /monitor/services ：各服务指标聚合（api/rpc/quote/route/indexer）
 * - GET /monitor/errors   ：错误事件统计（technical vs business）
 */
@Controller('analytics/monitor')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('health')
  health() {
    return this.monitor.getHealth();
  }

  @Get('services')
  services() {
    return this.monitor.getServices();
  }

  @Get('errors')
  errors(
    @Query('chainId') chainId?: string,
    @Query('type') type?: string,
  ) {
    return this.monitor.getErrors(
      chainId !== undefined ? Number(chainId) : undefined,
      type,
    );
  }
}
