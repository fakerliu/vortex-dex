import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { PriceAlert } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from './alerts.service';

const WETH = '0x4200000000000000000000000000000000000006';
const USER = '0x00000000000000000000000000000000000000aa';

/** 构造 mock 提醒行（target_price 为 Decimal）。 */
function makeAlert(overrides: Partial<Record<string, unknown>> = {}): PriceAlert {
  const base = {
    id: 'alert-1',
    user_address: USER,
    chain_id: 8453,
    token_address: WETH,
    symbol: 'WETH',
    condition: 'gte',
    target_price: new Prisma.Decimal('2500'),
    notify_method: 'in_app',
    status: 'active',
    triggered_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
  return { ...base, ...overrides } as unknown as PriceAlert;
}

/** 构造 mock 快照行。 */
function makeSnapshot(priceUsd: string | null): Record<string, unknown> {
  return {
    id: 'snap-1',
    chain_id: 8453,
    token_address: WETH,
    price_usd: priceUsd === null ? null : new Prisma.Decimal(priceUsd),
    quote_token: null,
    liquidity_usd: null,
    authenticity: 'REAL_ONCHAIN',
    source: null,
    block_number: 100,
    created_at: new Date('2026-01-02T00:00:00Z'),
  };
}

describe('AlertsService', () => {
  let service: AlertsService;
  let create: jest.Mock;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let remove: jest.Mock;
  let snapshotFindFirst: jest.Mock;

  beforeEach(async () => {
    create = jest.fn();
    findMany = jest.fn();
    findUnique = jest.fn();
    update = jest.fn();
    remove = jest.fn();
    snapshotFindFirst = jest.fn();

    const prisma = {
      priceAlert: {
        create,
        findMany,
        findUnique,
        update,
        delete: remove,
      },
      marketSnapshot: { findFirst: snapshotFindFirst },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AlertsService);
  });

  it('createAlert 正常创建并返回 DTO', async () => {
    create.mockResolvedValue(makeAlert());

    const result = await service.createAlert({
      userAddress: '0X00000000000000000000000000000000000000AA', // 大写 0X 前缀 + 大写十六进制，应被规范化为小写
      chainId: 8453,
      tokenAddress: '0X4200000000000000000000000000000000000006',
      symbol: 'WETH',
      condition: 'gte',
      targetPrice: '2500',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.user_address).toBe(USER); // USER 为小写 0x...aa
    expect(data.token_address).toBe(WETH); // WETH 为小写 0x4200...06
    expect(data.condition).toBe('gte');
    expect(data.notify_method).toBe('in_app');
    expect(result.targetPrice).toBe('2500');
    expect(result.status).toBe('active');
    expect(result.triggeredAt).toBeNull();
  });

  it('checkPriceAlerts：gte 命中（latest >= target → triggered）', async () => {
    const alert = makeAlert({ condition: 'gte', target_price: new Prisma.Decimal('2500') });
    findMany.mockResolvedValue([alert]);
    snapshotFindFirst.mockResolvedValue(makeSnapshot('2600'));
    update.mockResolvedValue(
      makeAlert({
        condition: 'gte',
        target_price: new Prisma.Decimal('2500'),
        status: 'triggered',
        triggered_at: new Date('2026-01-03T00:00:00Z'),
      }),
    );

    const result = await service.checkPriceAlerts();

    expect(result.checked).toBe(1);
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].status).toBe('triggered');
    expect(result.triggered[0].triggeredAt).toBe('2026-01-03T00:00:00.000Z');
    expect(update).toHaveBeenCalledWith({
      where: { id: alert.id },
      data: { status: 'triggered', triggered_at: expect.any(Date) },
    });
  });

  it('checkPriceAlerts：无快照跳过（不触发）', async () => {
    findMany.mockResolvedValue([makeAlert()]);
    snapshotFindFirst.mockResolvedValue(null);

    const result = await service.checkPriceAlerts();

    expect(result.checked).toBe(1);
    expect(result.triggered).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('checkPriceAlerts：lte 命中（latest <= target → triggered）', async () => {
    const alert = makeAlert({ condition: 'lte', target_price: new Prisma.Decimal('2500') });
    findMany.mockResolvedValue([alert]);
    snapshotFindFirst.mockResolvedValue(makeSnapshot('2400'));
    update.mockResolvedValue(
      makeAlert({
        condition: 'lte',
        target_price: new Prisma.Decimal('2500'),
        status: 'triggered',
        triggered_at: new Date('2026-01-03T00:00:00Z'),
      }),
    );

    const result = await service.checkPriceAlerts();

    expect(result.checked).toBe(1);
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].condition).toBe('lte');
  });

  it('checkPriceAlerts：BigInt 定点比较正确（微差不会被 Float 抹平）', async () => {
    // lte 提醒 target=2500，最新价 2500.000000000000000001（略高于目标）
    // 用 Float 会误判为相等，BigInt 定点应正确判定「未命中」。
    const alert = makeAlert({ condition: 'lte', target_price: new Prisma.Decimal('2500') });
    findMany.mockResolvedValue([alert]);
    snapshotFindFirst.mockResolvedValue(makeSnapshot('2500.000000000000000001'));

    const result = await service.checkPriceAlerts();

    expect(result.checked).toBe(1);
    expect(result.triggered).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('checkPriceAlerts：传入 user 时按用户过滤（不跨用户触发）', async () => {
    const otherUser = '0x00000000000000000000000000000000000000bb';
    findMany.mockResolvedValue([makeAlert()]);
    snapshotFindFirst.mockResolvedValue(makeSnapshot('2600'));
    update.mockResolvedValue(
      makeAlert({
        condition: 'gte',
        target_price: new Prisma.Decimal('2500'),
        status: 'triggered',
        triggered_at: new Date('2026-01-03T00:00:00Z'),
      }),
    );

    await service.checkPriceAlerts(otherUser);

    // 断言 findMany 的 where 同时包含 status 与 user_address 过滤
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('active');
    expect(where.user_address).toBe(otherUser);
  });

  it('checkPriceAlerts：省略 user 时全局检查（系统惰性触发）', async () => {
    findMany.mockResolvedValue([makeAlert()]);
    snapshotFindFirst.mockResolvedValue(null);

    await service.checkPriceAlerts();

    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('active');
    expect(where.user_address).toBeUndefined();
  });

  it('checkPriceAlerts：传入非法 userAddress 抛 BadRequestException（不退化为全局检查）', async () => {
    await expect(
      service.checkPriceAlerts('not-an-address'),
    ).rejects.toThrow('userAddress 不是合法的 EVM 地址');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('updateAlert 找不到抛 NotFoundException', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.updateAlert('missing-id', { status: 'paused' }),
    ).rejects.toThrow('提醒不存在');
  });
});
