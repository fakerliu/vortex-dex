import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { MarketSnapshot, Token } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketRankingService } from './market-ranking.service';

/** 构造 mock 快照行（price_usd 为 Decimal）。 */
function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}): MarketSnapshot {
  const base = {
    id: 'snap-1',
    chain_id: 8453,
    token_address: '0x0000000000000000000000000000000000000001',
    price_usd: new Prisma.Decimal('100'),
    quote_token: '0x0000000000000000000000000000000000000usdc',
    liquidity_usd: null,
    authenticity: 'REAL_ONCHAIN',
    source: 'onchain-quote-via-usdc',
    block_number: 100,
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
  return { ...base, ...overrides } as unknown as MarketSnapshot;
}

function makeToken(overrides: Partial<Record<string, unknown>> = {}): Token {
  const base = {
    id: 'tok-1',
    chain_id: 8453,
    address: '0x0000000000000000000000000000000000000001',
    symbol: 'AAA',
    name: 'Token AAA',
    logo_uri: null,
    is_verified: true,
    risk: false,
    decimals: 18,
  };
  return { ...base, ...overrides } as unknown as Token;
}

describe('MarketRankingService priceChange', () => {
  let service: MarketRankingService;
  let tokenFindMany: jest.Mock;
  let snapshotFindMany: jest.Mock;
  let swapGroupBy: jest.Mock;

  beforeEach(async () => {
    tokenFindMany = jest.fn();
    snapshotFindMany = jest.fn();
    swapGroupBy = jest.fn();
    const prisma = {
      token: { findMany: tokenFindMany },
      marketSnapshot: { findMany: snapshotFindMany },
      swap: { groupBy: swapGroupBy },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketRankingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(MarketRankingService);

    tokenFindMany.mockResolvedValue([]);
    swapGroupBy.mockResolvedValue([]);
  });

  it('有前后两条快照时 priceChange 计算正确（正负号）', async () => {
    const addr = '0x0000000000000000000000000000000000000001';
    const latest = makeSnapshot({
      id: 'snap-latest',
      price_usd: new Prisma.Decimal('110'),
      created_at: new Date('2026-01-02T00:00:00Z'),
    });
    const prev = makeSnapshot({
      id: 'snap-prev',
      price_usd: new Prisma.Decimal('100'),
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    tokenFindMany.mockResolvedValue([makeToken()]);
    // 模拟 DB 已按 token_address asc + created_at desc 排序返回
    snapshotFindMany.mockResolvedValue([latest, prev]);

    const result = await service.getRanking(8453, 'price_change');

    expect(result.sortBy).toBe('price_change');
    const item = result.items.find((i) => i.address === addr);
    expect(item).toBeDefined();
    expect(item!.priceChange).toBe('0.1');
  });

  it('只有一条快照时 priceChange 为 null', async () => {
    const addr = '0x0000000000000000000000000000000000000001';
    const only = makeSnapshot({
      id: 'snap-only',
      price_usd: new Prisma.Decimal('110'),
    });
    tokenFindMany.mockResolvedValue([makeToken()]);
    snapshotFindMany.mockResolvedValue([only]);

    const result = await service.getRanking(8453, 'price_change');

    const item = result.items.find((i) => i.address === addr);
    expect(item).toBeDefined();
    expect(item!.priceChange).toBeNull();
  });

  it('prev 为零时 priceChange 为 null', async () => {
    const addr = '0x0000000000000000000000000000000000000001';
    const latest = makeSnapshot({
      id: 'snap-latest',
      price_usd: new Prisma.Decimal('110'),
      created_at: new Date('2026-01-02T00:00:00Z'),
    });
    const prev = makeSnapshot({
      id: 'snap-prev',
      price_usd: new Prisma.Decimal('0'),
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    tokenFindMany.mockResolvedValue([makeToken()]);
    snapshotFindMany.mockResolvedValue([latest, prev]);

    const result = await service.getRanking(8453, 'price_change');

    const item = result.items.find((i) => i.address === addr);
    expect(item!.priceChange).toBeNull();
  });

  it('price_change 排序按涨跌幅降序，tie-break 价格降序', async () => {
    const addrA = '0x000000000000000000000000000000000000000a';
    const addrB = '0x000000000000000000000000000000000000000b';
    const addrC = '0x000000000000000000000000000000000000000c';
    const snapA = makeSnapshot({
      id: 'a-latest',
      token_address: addrA,
      price_usd: new Prisma.Decimal('200'),
      created_at: new Date('2026-01-02T00:00:00Z'),
    });
    const snapAPrev = makeSnapshot({
      id: 'a-prev',
      token_address: addrA,
      price_usd: new Prisma.Decimal('100'),
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    const snapB = makeSnapshot({
      id: 'b-latest',
      token_address: addrB,
      price_usd: new Prisma.Decimal('110'),
      created_at: new Date('2026-01-02T00:00:00Z'),
    });
    const snapBPrev = makeSnapshot({
      id: 'b-prev',
      token_address: addrB,
      price_usd: new Prisma.Decimal('100'),
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    const snapC = makeSnapshot({
      id: 'c-only',
      token_address: addrC,
      price_usd: new Prisma.Decimal('999'),
      created_at: new Date('2026-01-02T00:00:00Z'),
    });
    tokenFindMany.mockResolvedValue([
      makeToken({ address: addrA, symbol: 'AAA' }),
      makeToken({ address: addrB, symbol: 'BBB' }),
      makeToken({ address: addrC, symbol: 'CCC' }),
    ]);
    // 同一 token 多条记录连续，按 created_at desc
    snapshotFindMany.mockResolvedValue([
      snapA,
      snapAPrev,
      snapB,
      snapBPrev,
      snapC,
    ]);

    const result = await service.getRanking(8453, 'price_change');

    const order = result.items.map((i) => i.address);
    // A: +100%, B: +10%, C: null（排最后）
    expect(order).toEqual([addrA, addrB, addrC]);
  });
});
