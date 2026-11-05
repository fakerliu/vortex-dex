import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * 价格提醒模块（V1.2）。
 *
 * 只依赖 PrismaService（@Global 的 PrismaModule，无需 import），
 * 不依赖 MarketService —— Market 模块单向 import 本模块做惰性触发，
 * 因此无循环依赖。
 *
 * V1.3 起 import NotificationsModule（单向 Alerts → Notifications，无循环），
 * 供 AlertsService 注入 NotificationDispatcher，在提醒触发后落站内通知。
 *
 * exports AlertsService：供 MarketModule 注入，在快照落库后触发检查。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
