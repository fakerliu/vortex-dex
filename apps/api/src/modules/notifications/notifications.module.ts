import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * 站内通知中心模块（V1.3）。
 *
 * 只依赖 PrismaService（@Global 的 PrismaModule，无需 import）。
 * AlertsService 触发提醒命中后调用本服务写通知（由 V1.3-2a 实现接线）。
 *
 * exports NotificationsService：供 AlertsModule 注入，在提醒触发后落站内通知。
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
