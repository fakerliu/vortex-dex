import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SplitService } from './split.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DexPoolService, type PoolQuoteCandidate } from '../../dex/dex-pool.service';
import { AerodromeClassicAdapter } from '../../dex/aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from '../../dex/aerodrome/aerodrome-cl.adapter';
import { UniswapV3Adapter } from '../../dex/uniswap-v3/uniswap-v3.adapter';
import { SwapService } from './swap.service';
import { MarketService } from '../market/market.service';
import { formatUnits } from '../../common/utils/units';

/** 40 hex 字符地址（满足 isValidAddress）。 */
const ADDR = (c: string) => `0x${c.repeat(40)}`;

const tokenIn = ADDR('1');
const tokenOut = ADDR('2');
const user = ADDR('3');
const spender = ADDR('f');
const poolA = ADDR('a');
const poolB = ADDR('b');
const poolC = ADDR('c');
const poolD = ADDR('d');

/** 线性价格影响模型：impact = amountIn / capacity（18 位定点）。 */
function linearImpact(amountIn: string, capacity: bigint): string {
  const fixed = (BigInt(amountIn) * 10n ** 18n) / capacity;
  return formatUnits(fixed.toString(), 18);
}

function makeCandidate(
  poolAddress: string,
  amountOut: string,
  priceImpact: string,
): PoolQuoteCandidate {
  return {
    pool: {
      chainId: 8453,
      address: poolAddress,
      token0: tokenIn,
      token1: tokenOut,
      kind: 'classic-volatile',
      fee: '3000',
      feeRaw: '30',
      stable: false,
    },
    protocolType: 'aerodrome_classic',
    quote: {
      chainId: 8453,
      poolAddress,
      tokenIn,
      tokenOut,
      amountIn: '100',
      amountOut,
      kind: 'classic-volatile',
      fee: '3000',
      priceImpact,
      source: 'constant-product',
      route: [{ pool: poolAddress, kind: 'classic-volatile' }],
    },
    gas: { gasLimit: '250000', source: 'static', estimated: true },
  };
}

function makeQuote(poolAddress: string, amountIn: string, capacity: bigint) {
  return {
    chainId: 8453,
    poolAddress,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: amountIn,
    kind: 'classic-volatile',
    fee: '3000',
    priceImpact: linearImpact(amountIn, capacity),
    source: 'constant-product',
    route: [{ pool: poolAddress, kind: 'classic-volatile' }],
  };
}

function makePrepared(req: {
  chainId: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  route: { poolPath: string[] };
}, capacityFor: (poolAddress: string) => bigint) {
  const poolAddress = req.route.poolPath[0];
  const capacity = capacityFor(poolAddress);
  return {
    chainId: req.chainId,
    userAddress: req.userAddress,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut: req.amountIn,
    minimumReceived: req.amountIn,
    priceImpact: linearImpact(req.amountIn, capacity),
    slippageBps: req.slippageBps ?? 50,
    deadline: 1730000000,
    protocol: 'aerodrome_classic',
    route: [],
    balance: '0',
    allowance: '0',
    spender,
    needsApproval: true,
    approvalAmount: req.amountIn,
    transaction: {
      to: spender,
      value: '0',
      data: '0x',
      functionName: 'swapExactTokensForTokens',
      selector: '0x00000000',
      gasLimit: '250000',
    },
    approval: null,
    quoteTimestamp: '2026-01-01T00:00:00Z',
    notes: [],
  };
}

describe('SplitService', () => {
  let service: SplitService;

  // mock 引用
  let prisma: {
    splitOrder: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    splitChild: { createMany: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    token: { findUnique: jest.Mock };
  };
  let poolService: {
    discoverPools: jest.Mock;
    quotePair: jest.Mock;
    discoverUniswapV3Pools: jest.Mock;
    quoteUniswapV3Pair: jest.Mock;
  };
  let swapService: { prepare: jest.Mock; submit: jest.Mock };
  let market: { getTokenPrice: jest.Mock };
  let classic: { getQuote: jest.Mock };
  let cl: { getQuote: jest.Mock };
  let uniswapV3: { getQuote: jest.Mock };

  beforeEach(async () => {
    prisma = {
      splitOrder: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      splitChild: {
        createMany: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      token: { findUnique: jest.fn() },
    };
    poolService = {
      discoverPools: jest.fn(),
      quotePair: jest.fn(),
      discoverUniswapV3Pools: jest.fn(),
      quoteUniswapV3Pair: jest.fn(),
    };
    swapService = { prepare: jest.fn(), submit: jest.fn() };
    market = { getTokenPrice: jest.fn() };
    classic = { getQuote: jest.fn() };
    cl = { getQuote: jest.fn() };
    uniswapV3 = { getQuote: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SplitService,
        { provide: PrismaService, useValue: prisma },
        { provide: DexPoolService, useValue: poolService },
        { provide: SwapService, useValue: swapService },
        { provide: MarketService, useValue: market },
        { provide: AerodromeClassicAdapter, useValue: classic },
        { provide: AerodromeClAdapter, useValue: cl },
        { provide: UniswapV3Adapter, useValue: uniswapV3 },
      ],
    }).compile();
    service = moduleRef.get(SplitService);

    // 默认：USD 换算失败 → 跳过金额条件（仅按 priceImpact 判定）
    market.getTokenPrice.mockResolvedValue({
      chainId: 8453,
      tokenAddress: tokenIn,
      priceUsd: null,
      quoteToken: null,
      authenticity: 'UNAVAILABLE',
      source: null,
      blockNumber: null,
    });
    prisma.splitOrder.create.mockImplementation(async (args: { data: unknown }) => ({
      id: 'order-1',
      ...(args.data as object),
    }));
    prisma.splitChild.createMany.mockResolvedValue({ count: 1 });
  });

  it('金额分配正确性：两池按效率拆，金额守恒，聚合授权按 spender 求和', async () => {
    const capacity: Record<string, bigint> = { [poolA]: 4000n, [poolB]: 5000n };
    poolService.discoverPools.mockResolvedValue({
      classicPools: [
        { address: poolA, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolB, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
      ],
      clPools: [],
    });
    poolService.quotePair.mockResolvedValue([
      makeCandidate(poolA, '90', '0.05'),
      makeCandidate(poolB, '80', '0.05'),
    ]);
    classic.getQuote.mockImplementation((p: { poolAddress: string; amountIn: string }) =>
      Promise.resolve(makeQuote(p.poolAddress, p.amountIn, capacity[p.poolAddress])),
    );
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, (a) => capacity[a])),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
      slippageBps: 50,
    });

    expect(result.splits.length).toBe(2);
    expect(result.splits[0]).toMatchObject({ index: 1, poolAddress: poolA, amountIn: '40' });
    expect(result.splits[1]).toMatchObject({ index: 2, poolAddress: poolB, amountIn: '60' });
    expect(result.splits.reduce((s, c) => s + BigInt(c.amountIn), 0n)).toBe(100n);
    expect(result.amountOutTotal).toBe('100');
    // 聚合授权：同一 spender 求和
    expect(result.approvals.length).toBe(1);
    expect(result.approvals[0].spender).toBe(spender);
    expect(result.approvals[0].amount).toBe('100');
    expect(result.approvals[0].needed).toBe(true);
    // 加权整体价格影响 = (40*0.01 + 60*0.012)/100 = 0.0112
    expect(result.priceImpactAggregated).toBe('0.0112');
    expect(result.splitOrderId).toBe('order-1');
    // 落库子单
    expect(prisma.splitChild.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ pool_address: poolA, order_index: 1 }),
          expect.objectContaining({ pool_address: poolB, order_index: 2 }),
        ]),
      }),
    );
  });

  it('priceImpact 阈值边界：最优单路径未达阈值 → 回退单路径', async () => {
    const capacity: Record<string, bigint> = { [poolA]: 4000n, [poolB]: 5000n };
    poolService.discoverPools.mockResolvedValue({
      classicPools: [
        { address: poolA, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolB, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
      ],
      clPools: [],
    });
    poolService.quotePair.mockResolvedValue([
      makeCandidate(poolA, '90', '0.005'),
      makeCandidate(poolB, '80', '0.004'),
    ]);
    classic.getQuote.mockImplementation((p: { poolAddress: string; amountIn: string }) =>
      Promise.resolve(makeQuote(p.poolAddress, p.amountIn, capacity[p.poolAddress])),
    );
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, (a) => capacity[a])),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
    });

    expect(result.splits.length).toBe(1);
    expect(result.splits[0].poolAddress).toBe(poolA); // amountOut 最大的候选
    expect(result.splits[0].amountIn).toBe('100');
    expect(result.notes.some((n) => n.includes('未达阈值'))).toBe(true);
  });

  it('单池不足回退：仅 1 个候选 → 不拆分', async () => {
    poolService.discoverPools.mockResolvedValue({
      classicPools: [
        { address: poolA, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
      ],
      clPools: [],
    });
    poolService.quotePair.mockResolvedValue([makeCandidate(poolA, '90', '0.05')]);
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, () => 4000n)),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
    });

    expect(result.splits.length).toBe(1);
    expect(result.splits[0].poolAddress).toBe(poolA);
    expect(result.splits[0].amountIn).toBe('100');
    expect(result.notes.some((n) => n.includes('候选池不足'))).toBe(true);
  });

  it('流动性不足：阈值内无法分完，最后一池承接剩余并标注', async () => {
    const capacity: Record<string, bigint> = { [poolA]: 1000n, [poolB]: 1000n };
    poolService.discoverPools.mockResolvedValue({
      classicPools: [
        { address: poolA, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolB, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
      ],
      clPools: [],
    });
    poolService.quotePair.mockResolvedValue([
      makeCandidate(poolA, '90', '0.2'),
      makeCandidate(poolB, '80', '0.2'),
    ]);
    classic.getQuote.mockImplementation((p: { poolAddress: string; amountIn: string }) =>
      Promise.resolve(makeQuote(p.poolAddress, p.amountIn, capacity[p.poolAddress])),
    );
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, (a) => capacity[a])),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
    });

    // 阈值 0.01 → 每池阈值内 cap = 10；A=10，B 承接剩余 90
    expect(result.splits.length).toBe(2);
    expect(result.splits[0].amountIn).toBe('10');
    expect(result.splits[1].amountIn).toBe('90');
    expect(result.splits.reduce((s, c) => s + BigInt(c.amountIn), 0n)).toBe(100n);
    expect(result.notes.some((n) => n.includes('流动性不足'))).toBe(true);
  });

  it('maxSplits 上限：超出上限时停在第 N 池并承接剩余', async () => {
    const capacity: Record<string, bigint> = {
      [poolA]: 4000n,
      [poolB]: 4000n,
      [poolC]: 4000n,
      [poolD]: 4000n,
    };
    poolService.discoverPools.mockResolvedValue({
      classicPools: [
        { address: poolA, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolB, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolC, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolD, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
      ],
      clPools: [],
    });
    poolService.quotePair.mockResolvedValue([
      makeCandidate(poolA, '90', '0.05'),
      makeCandidate(poolB, '80', '0.05'),
      makeCandidate(poolC, '70', '0.05'),
      makeCandidate(poolD, '60', '0.05'),
    ]);
    classic.getQuote.mockImplementation((p: { poolAddress: string; amountIn: string }) =>
      Promise.resolve(makeQuote(p.poolAddress, p.amountIn, capacity[p.poolAddress])),
    );
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, (a) => capacity[a])),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
      maxSplits: 2,
    });

    // 每池阈值内 cap=40；A=40，B=40，剩余 20 由 B 承接 → 2 条
    expect(result.splits.length).toBe(2);
    expect(result.splits[0].amountIn).toBe('40');
    expect(result.splits[1].amountIn).toBe('60');
    expect(result.splits.reduce((s, c) => s + BigInt(c.amountIn), 0n)).toBe(100n);
  });

  it('金额未达 USD 阈值 → 不拆分', async () => {
    market.getTokenPrice.mockResolvedValue({
      chainId: 8453,
      tokenAddress: tokenIn,
      priceUsd: '1',
      quoteToken: tokenOut,
      authenticity: 'REAL_ONCHAIN',
      source: 'onchain-quote-via-usdc',
      blockNumber: 1,
    });
    prisma.token.findUnique.mockResolvedValue(null); // decimals 兜底 18

    poolService.discoverPools.mockResolvedValue({
      classicPools: [
        { address: poolA, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
        { address: poolB, token0: tokenIn, token1: tokenOut, kind: 'classic-volatile', fee: '3000', feeRaw: '30' },
      ],
      clPools: [],
    });
    poolService.quotePair.mockResolvedValue([
      makeCandidate(poolA, '90', '0.05'),
      makeCandidate(poolB, '80', '0.05'),
    ]);
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, () => 4000n)),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '1',
    });

    expect(result.splits.length).toBe(1);
    expect(result.notes.some((n) => n.includes('金额未达 USD 阈值'))).toBe(true);
  });
});
