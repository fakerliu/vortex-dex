import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { NotificationDto, UnreadCountDto } from './notifications.types';

/**
 * 站内通知中心 API（V1.3，挂 /api/v1 前缀，路由为 /api/v1/notifications）。
 * - GET    /notifications?user=:address       列出用户通知（未读优先、created_at 降序）
 * - PATCH  /notifications/:id/read            标记已读
 * - POST   /notifications/read-all            全部已读（body: { userAddress }）
 * - GET    /notifications/unread-count?user=:address  未读数（顶栏角标）
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Query('user') user?: string): Promise<NotificationDto[]> {
    return this.notificationsService.listNotifications(user ?? '');
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string): Promise<NotificationDto> {
    return this.notificationsService.markRead(id);
  }

  @Post('read-all')
  markAllRead(
    @Body() body: { userAddress: string },
  ): Promise<{ updated: number }> {
    return this.notificationsService.markAllRead(body?.userAddress ?? '');
  }

  @Get('unread-count')
  unreadCount(@Query('user') user?: string): Promise<UnreadCountDto> {
    return this.notificationsService.unreadCount(user ?? '');
  }
}
