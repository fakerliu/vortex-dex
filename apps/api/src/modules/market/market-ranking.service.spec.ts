import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { MarketSnapshot, Token } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { MarketService } from './market.service';
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
  let poolFindMany: jest.Mock;
  let swapEventFindMany: jest.Mock;

  beforeEach(async () => {
    tokenFindMany = jest.fn();
    snapshotFindMany = jest.fn();
    poolFindMany = jest.fn();
    swapEventFindMany = jest.fn();
    const prisma = {
      token: { findMany: tokenFindMany },
      marketSnapshot: { findMany: snapshotFindMany },
      pool: { findMany: poolFindMany },
      swapEvent: { findMany: swapEventFindMany },
    };
    // 成交量边界块二分：head=200、所有块 timestamp=now，二分收敛到 1。
    const chainRpc = {
      getClient: jest.fn(() => ({
        getBlockNumber: jest.fn().mockResolvedValue(200n),
        getBlock: jest.fn().mockResolvedValue({
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
        }),
      })),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketRankingService,
        { provide: PrismaService, useValue: prisma },
        { provide: MarketService, useValue: {} },
        { provide: ChainRpcService, useValue: chainRpc },
      ],
    }).compile();
    service = moduleRef.get(MarketRankingService);

    tokenFindMany.mockResolvedValue([]);
    poolFindMany.mockResolvedValue([]);
    swapEventFindMany.mockResolvedValue([]);
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

  it('成交量从 swap_events 聚合（classic Swap → tokenOut.amountOut → volumeUsd）', async () => {
    const weth = '0x4200000000000000000000000000000000000006';
    const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
    const pool = '0xcdac0d6c6c59727a65f871236188350531885c43';

    tokenFindMany.mockResolvedValue([
      makeToken({ address: weth, symbol: 'WETH', decimals: 18 }),
    ]);
    snapshotFindMany.mockResolvedValue([
      makeSnapshot({
        token_address: weth,
        price_usd: new Prisma.Decimal('100'),
      }),
    ]);
    poolFindMany.mockResolvedValue([
      { pool_address: pool, token0_address: weth, token1_address: usdc },
    ]);
    // classic：amount1In=5_000_000 USDC → amount0Out=1 WETH
    swapEventFindMany.mockResolvedValue([
      {
        id: 'ev-1',
        event_data: JSON.stringify({
          pool,
          poolId: 'pool-id-1',
          family: 'classic',
          protocolType: 'aerodrome_classic',
          sender: '0x0000000000000000000000000000000000000001',
          to: '0x0000000000000000000000000000000000000002',
          amount0In: '0',
          amount1In: '5000000',
          amount0Out: '1000000000000000000',
          amount1Out: '0',
        }),
      },
    ]);

    const result = await service.getRanking(8453, 'volume');
    const item = result.items.find((i) => i.address === weth);

    expect(item).toBeDefined();
    // 1 WETH × 100 USD = 100 USD
    expect(item!.volumeUsd).toBe('100');
    expect(item!.volumeAuthenticity).toBe('INTERNAL_CALCULATED');
  });

  it('CL Swap 方向推导正确（amount1>0 & amount0<0 → token1→token0）', async () => {
    const weth = '0x4200000000000000000000000000000000000006';
    const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
    const pool = '0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59';

    tokenFindMany.mockResolvedValue([
      makeToken({ address: weth, symbol: 'WETH', decimals: 18 }),
    ]);
    snapshotFindMany.mockResolvedValue([
      makeSnapshot({
        token_address: weth,
        price_usd: new Prisma.Decimal('100'),
      }),
    ]);
    poolFindMany.mockResolvedValue([
      { pool_address: pool, token0_address: weth, token1_address: usdc },
    ]);
    // CL：amount0=-2 WETH（流出），amount1=+X USDC（流入）→ tokenOut=token0=WETH，amountOut=2e18
    swapEventFindMany.mockResolvedValue([
      {
        id: 'ev-cl-1',
        event_data: JSON.stringify({
          pool,
          poolId: 'pool-id-cl-1',
          family: 'cl',
          protocolType: 'aerodrome_cl',
          sender: '0x0000000000000000000000000000000000000001',
          recipient: '0x0000000000000000000000000000000000000002',
          amount0: '-2000000000000000000',
          amount1: '10000000',
        }),
      },
    ]);

    const result = await service.getRanking(8453, 'volume');
    const item = result.items.find((i) => i.address === weth);

    expect(item).toBeDefined();
    // 2 WETH × 100 USD = 200 USD
    expect(item!.volumeUsd).toBe('200');
  });
});
