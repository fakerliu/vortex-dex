import { Test } from '@nestjs/testing';
import type { Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const USER = '0x00000000000000000000000000000000000000aa';
const WETH = '0x4200000000000000000000000000000000000006';

/** 构造 mock 通知行。 */
function makeNotification(
  overrides: Partial<Record<string, unknown>> = {},
): Notification {
  const base = {
    id: 'notif-1',
    user_address: USER,
    type: 'price_alert_triggered',
    title: 'WETH 价格提醒已触发',
    body: 'WETH 现价已 ≥ 2500，触发你的价格提醒',
    alert_id: 'alert-1',
    token_address: WETH,
    read: false,
    created_at: new Date('2026-01-03T00:00:00Z'),
  };
  return { ...base, ...overrides } as unknown as Notification;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let create: jest.Mock;
  let findFirst: jest.Mock;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let updateMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(async () => {
    create = jest.fn();
    findFirst = jest.fn();
    findMany = jest.fn();
    findUnique = jest.fn();
    update = jest.fn();
    updateMany = jest.fn();
    count = jest.fn();

    const prisma = {
      notification: {
        create,
        findFirst,
        findMany,
        findUnique,
        update,
        updateMany,
        count,
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('createNotification 正常落库并返回 DTO（地址规范化 + 字段映射）', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue(makeNotification());

    const result = await service.createNotification({
      userAddress: '0X00000000000000000000000000000000000000AA', // 大写应规范化为小写
      type: 'price_alert_triggered',
      title: 'WETH 价格提醒已触发',
      body: 'WETH 现价已 ≥ 2500，触发你的价格提醒',
      alertId: 'alert-1',
      tokenAddress: '0X4200000000000000000000000000000000000006',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.user_address).toBe(USER);
    expect(data.token_address).toBe(WETH);
    expect(data.read).toBe(false);
    expect(result).toMatchObject({
      id: 'notif-1',
      userAddress: USER,
      type: 'price_alert_triggered',
      alertId: 'alert-1',
      tokenAddress: WETH,
      read: false,
      createdAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('createNotification 幂等：同一 alertId 第二次返回 null，不重复落库', async () => {
    // 第一次：无已有通知 -> 落库
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValue(makeNotification());

    const first = await service.createNotification({
      userAddress: USER,
      type: 'price_alert_triggered',
      title: 'WETH 价格提醒已触发',
      body: 'WETH 现价已 ≥ 2500，触发你的价格提醒',
      alertId: 'alert-1',
    });

    // 第二次：已有通知 -> 跳过
    findFirst.mockResolvedValueOnce({ id: 'notif-1' });

    const second = await service.createNotification({
      userAddress: USER,
      type: 'price_alert_triggered',
      title: 'WETH 价格提醒已触发',
      body: 'WETH 现价已 ≥ 2500，触发你的价格提醒',
      alertId: 'alert-1',
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('listNotifications 未读优先 + created_at 降序（orderBy 断言）', async () => {
    findMany.mockResolvedValue([
      makeNotification({ id: 'n-unread', read: false }),
      makeNotification({ id: 'n-read', read: true }),
    ]);

    const result = await service.listNotifications(USER);

    expect(findMany).toHaveBeenCalledWith({
      where: { user_address: USER },
      orderBy: [{ read: 'asc' }, { created_at: 'desc' }],
    });
    expect(result).toHaveLength(2);
    expect(result[0].read).toBe(false);
  });

  it('markRead 标记单条已读并返回 DTO', async () => {
    findUnique.mockResolvedValue({ id: 'notif-1' });
    update.mockResolvedValue(makeNotification({ read: true }));

    const result = await service.markRead('notif-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
      data: { read: true },
    });
    expect(result.read).toBe(true);
  });

  it('markRead 找不到抛 NotFoundException', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.markRead('missing')).rejects.toThrow('通知不存在');
  });

  it('markAllRead 全部已读返回 updated 数量', async () => {
    updateMany.mockResolvedValue({ count: 3 });

    const result = await service.markAllRead(USER);

    expect(updateMany).toHaveBeenCalledWith({
      where: { user_address: USER, read: false },
      data: { read: true },
    });
    expect(result).toEqual({ updated: 3 });
  });

  it('unreadCount 返回未读数', async () => {
    count.mockResolvedValue(5);

    const result = await service.unreadCount(USER);

    expect(count).toHaveBeenCalledWith({
      where: { user_address: USER, read: false },
    });
    expect(result).toEqual({ count: 5 });
  });

  it('非法 userAddress 抛 BadRequestException', async () => {
    await expect(service.listNotifications('not-an-address')).rejects.toThrow(
      'userAddress 不是合法的 EVM 地址',
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});
