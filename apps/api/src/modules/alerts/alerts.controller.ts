import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import type {
  CheckAlertsResult,
  CreateAlertRequestDto,
  PriceAlertDto,
  UpdateAlertRequestDto,
} from './alerts.types';

/**
 * 价格提醒 API（挂 /api/v1 前缀，路由为 /api/v1/alerts）。
 * - POST   /api/v1/alerts           ：创建提醒
 * - GET    /api/v1/alerts?user=     ：列出某用户提醒（created_at 降序）
 * - PATCH  /api/v1/alerts/:id       ：更新（condition/target_price/notify_method/status）
 * - DELETE /api/v1/alerts/:id       ：删除
 * - POST   /api/v1/alerts/check     ：手动触发一次惰性检查
 */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  create(@Body() body: CreateAlertRequestDto): Promise<PriceAlertDto> {
    return this.alertsService.createAlert(body);
  }

  @Get()
  list(@Query('user') user?: string): Promise<PriceAlertDto[]> {
    return this.alertsService.listAlerts(user ?? '');
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateAlertRequestDto,
  ): Promise<PriceAlertDto> {
    return this.alertsService.updateAlert(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.alertsService.deleteAlert(id);
  }

  @Post('check')
  check(): Promise<CheckAlertsResult> {
    return this.alertsService.checkPriceAlerts();
  }
}
