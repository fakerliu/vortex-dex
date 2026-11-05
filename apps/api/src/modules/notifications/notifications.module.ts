import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { InAppProvider } from './in-app.provider';
import { NotificationDispatcher } from './notification-dispatcher';

/**
 * 站内通知中心模块（V1.3）。
 *
 * 只依赖 PrismaService（@Global 的 PrismaModule，无需 import）。
 * 导出 NotificationsService + NotificationDispatcher：
 * AlertsModule 注入 NotificationDispatcher，在提醒触发后落站内通知（由 V1.3-2a 接线）。
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, InAppProvider, NotificationDispatcher],
  exports: [NotificationsService, NotificationDispatcher],
})
export class NotificationsModule {}
