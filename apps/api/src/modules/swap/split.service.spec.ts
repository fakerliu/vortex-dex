import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import {
  computePriceImpact,
  getAmountOutConstantProduct,
  parseDecimal,
} from '../../dex/math';

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

/** 本地恒定乘积价格影响（定点 BigInt，与 adapter 同款纯函数）。 */
function localImpact(
  reserveIn: bigint,
  reserveOut: bigint,
  feePpm: bigint,
  amountIn: bigint,
): bigint {
  const amountOut = getAmountOutConstantProduct({
    reserveIn,
    reserveOut,
    amountIn,
    feePpm,
  });
  const priceImpact = computePriceImpact({
    amountIn,
    amountOut,
    midNum: reserveOut,
    midDen: reserveIn,
  });
  return parseDecimal(priceImpact, 18n);
}

/** 参考实现：对纯函数做二分（模拟链上 getAmountOut），作为解析式结果的对照。 */
function referenceBinaryCap(
  reserveIn: bigint,
  reserveOut: bigint,
  feePpm: bigint,
  thr: bigint,
  upperBound: bigint,
): bigint {
  let lo = 0n;
  let hi = upperBound;
  let best = 0n;
  while (lo <= hi) {
    const mid = (lo + hi) / 2n;
    if (mid === 0n) {
      lo = 1n;
      continue;
    }
    if (localImpact(reserveIn, reserveOut, feePpm, mid) <= thr) {
      best = mid;
      lo = mid + 1n;
    } else {
      hi = mid - 1n;
    }
  }
  return best;
}

describe('SplitService', () => {
  let service: SplitService;

  // mock 引用
  let prisma: {
    splitOrder: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    splitChild: { createMany: jest.Mock; update: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    token: { findUnique: jest.Mock };
  };
  let poolService: {
    discoverPools: jest.Mock;
    quotePair: jest.Mock;
    discoverUniswapV3Pools: jest.Mock;
    quoteUniswapV3Pair: jest.Mock;
  };
  let swapService: { prepare: jest.Mock; submit: jest.Mock; tryReadReceipt: jest.Mock };
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
        updateMany: jest.fn(),
      },
      token: { findUnique: jest.fn() },
    };
    poolService = {
      discoverPools: jest.fn(),
      quotePair: jest.fn(),
      discoverUniswapV3Pools: jest.fn(),
      quoteUniswapV3Pair: jest.fn(),
    };
    swapService = { prepare: jest.fn(), submit: jest.fn(), tryReadReceipt: jest.fn() };
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

  it('priceImpactThreshold 覆盖：请求值生效，未达覆盖阈值 → 不拆分', async () => {
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
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, (a) => capacity[a])),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
      priceImpactThreshold: '0.2',
    });

    // 默认阈值 0.01 下 0.05 会触发拆分；覆盖为 0.2 后未达阈值 → 回退单路径
    expect(result.splits.length).toBe(1);
    expect(result.splits[0].poolAddress).toBe(poolA);
    expect(result.notes.some((n) => n.includes('未达阈值'))).toBe(true);
  });

  it('minAmountUsd 覆盖：非法值抛 BadRequestException', async () => {
    await expect(
      service.prepareSplit({
        chainId: 8453,
        userAddress: user,
        tokenIn,
        tokenOut,
        amountIn: '100',
        minAmountUsd: 'abc',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('submitChild 链上 revert：子单置 FAILED，母单重算为 failed', async () => {
    prisma.splitOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'pending',
      child_count: 1,
      user_address: user,
      chain_id: 8453,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: new Prisma.Decimal('100'),
      intent_id: null,
      children: [
        {
          id: 'child-1',
          split_order_id: 'order-1',
          order_index: 1,
          status: 'pending',
          amount_in: new Prisma.Decimal('100'),
          amount_out: new Prisma.Decimal('100'),
          pool_address: poolA,
          protocol_type: 'aerodrome_classic',
          price_impact: new Prisma.Decimal('0.01'),
          swap_id: null,
        },
      ],
    });
    swapService.submit.mockResolvedValue({ id: 'swap-1' });
    swapService.tryReadReceipt.mockResolvedValue({ status: 'reverted' });
    prisma.splitChild.update.mockResolvedValue({ id: 'child-1' });
    prisma.splitChild.findMany.mockResolvedValue([{ status: 'failed' }]);
    prisma.splitOrder.update.mockResolvedValue({ id: 'order-1', status: 'failed' });

    const result = await service.submitChild('order-1', {
      childIndex: 1,
      txHash: '0x' + 'a'.repeat(64),
      amountOut: '100',
    });

    expect(prisma.splitChild.update).toHaveBeenCalledWith({
      where: { id: 'child-1' },
      data: { swap_id: 'swap-1', status: 'failed' },
    });
    expect(result.status).toBe('failed');
  });

  it('cancelSplitOrder：pending 母单可取消，pending 子单置 failed', async () => {
    prisma.splitOrder.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        status: 'pending',
        child_count: 2,
        user_address: user,
        chain_id: 8453,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: new Prisma.Decimal('100'),
        intent_id: null,
        children: [
          { id: 'child-1', order_index: 1, status: 'pending' },
          { id: 'child-2', order_index: 2, status: 'confirmed' },
        ],
      })
      .mockResolvedValueOnce({
        id: 'order-1',
        status: 'cancelled',
        child_count: 2,
        amount_in: new Prisma.Decimal('100'),
        token_in: tokenIn,
        token_out: tokenOut,
        chain_id: 8453,
        children: [
          { order_index: 1, pool_address: poolA, protocol_type: 'aerodrome_classic', amount_in: new Prisma.Decimal('50'), amount_out: new Prisma.Decimal('50'), status: 'failed', swap_id: null, swap: null },
          { order_index: 2, pool_address: poolB, protocol_type: 'aerodrome_classic', amount_in: new Prisma.Decimal('50'), amount_out: new Prisma.Decimal('50'), status: 'confirmed', swap_id: 'swap-2', swap: { tx_hash: '0x' + 'b'.repeat(64) } },
        ],
      });
    prisma.splitChild.updateMany.mockResolvedValue({ count: 1 });
    prisma.splitOrder.update.mockResolvedValue({ id: 'order-1', status: 'cancelled' });

    const result = await service.cancelSplitOrder('order-1');

    expect(prisma.splitChild.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['child-1'] } },
      data: { status: 'failed' },
    });
    expect(prisma.splitOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'cancelled' },
    });
    expect(result.status).toBe('cancelled');
    expect(result.children[0].status).toBe('failed');
    expect(result.children[1].status).toBe('confirmed');
  });

  it('cancelSplitOrder：completed 母单不可取消，抛 400', async () => {
    prisma.splitOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'completed',
      child_count: 1,
      user_address: user,
      chain_id: 8453,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: new Prisma.Decimal('100'),
      intent_id: null,
      children: [{ id: 'child-1', order_index: 1, status: 'confirmed' }],
    });

    await expect(service.cancelSplitOrder('order-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('二分探测 revert 兜底：超大金额报价失败时收缩上界，不抛异常', async () => {
    // 池子真实流动性上限 60（超过即链上 getAmountOut revert），priceImpact 容量 60000
    const RESERVE = 60n;
    const CAPACITY = 60000n;
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
    // 二分探测金额超过池流动性时 revert（模拟链上 getAmountOut revert）
    classic.getQuote.mockImplementation((p: { poolAddress: string; amountIn: string }) => {
      if (BigInt(p.amountIn) > RESERVE) {
        return Promise.reject(
          new Error('The contract function "getAmountOut" reverted'),
        );
      }
      return Promise.resolve(makeQuote(p.poolAddress, p.amountIn, CAPACITY));
    });
    swapService.prepare.mockImplementation((req: unknown) =>
      Promise.resolve(makePrepared(req as never, () => CAPACITY)),
    );

    const result = await service.prepareSplit({
      chainId: 8453,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: '100',
      priceImpactThreshold: '0.001',
    });

    // 不崩溃，金额守恒：poolA 承接 cap=60，poolB 承接剩余 40
    expect(result.splits.length).toBe(2);
    expect(result.splits.reduce((s, c) => s + BigInt(c.amountIn), 0n)).toBe(100n);
    expect(result.splits[0].amountIn).toBe('60');
    expect(result.splits[1].amountIn).toBe('40');
  });

  it('快速路径：全额报价 priceImpact 已 ≤ 阈值 → 直接返回 upperBound，不再二次报价', async () => {
    // 候选池在 discoverCandidates 阶段的全额报价 priceImpact=0.005 ≤ 阈值 0.01
    const candidate = makeCandidate(poolA, '90', '0.005');
    classic.getQuote.mockResolvedValue(makeQuote(poolA, '100', 4000n));

    const cap = await (service as unknown as {
      binarySearchCap: (
        chainId: number,
        tokenIn: string,
        tokenOut: string,
        candidate: PoolQuoteCandidate,
        threshold: string,
        upperBound: bigint,
      ) => Promise<bigint>;
    }).binarySearchCap(8453, tokenIn, tokenOut, candidate, '0.01', 100n);

    expect(cap).toBe(100n);
    // 快速路径应直接返回，不再触发任何 RPC 探测报价
    expect(classic.getQuote).not.toHaveBeenCalled();
  });

  // ---------- classic-volatile 解析式免二分 ----------

  type BinarySearchCapFn = (
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    candidate: PoolQuoteCandidate,
    threshold: string,
    upperBound: bigint,
  ) => Promise<bigint>;

  // 以方法调用形式触发（绑定 this），避免裸函数调用导致 this 为 undefined
  const binarySearchCap = (
    candidate: PoolQuoteCandidate,
    threshold: string,
    upperBound: bigint,
  ): Promise<bigint> =>
    (service as unknown as { binarySearchCap: BinarySearchCapFn }).binarySearchCap(
      8453,
      tokenIn,
      tokenOut,
      candidate,
      threshold,
      upperBound,
    );

  it('解析式免二分：cap 与纯函数二分一致，且不触发探测 RPC', async () => {
    const RESERVE0 = 1_000_000n;
    const RESERVE1 = 2_000_000n;
    const FEE = 3000n;
    const THRESHOLD = '0.01';
    const thr = parseDecimal(THRESHOLD, 18n);

    const candidate = makeCandidate(poolA, '90', '0.05');
    candidate.quote.reserve0 = RESERVE0.toString();
    candidate.quote.reserve1 = RESERVE1.toString();

    const reference = referenceBinaryCap(RESERVE0, RESERVE1, FEE, thr, 1_000_000n);
    const cap = await binarySearchCap(candidate, THRESHOLD, 1_000_000n);

    expect(cap).toBe(reference);
    // 解析式路径不应触发任何 RPC 探测报价（getQuote 未被调用）
    expect(classic.getQuote).not.toHaveBeenCalled();
    // 边界校验：cap 处价格影响 ≤ 阈值，cap+1 处 > 阈值
    expect(localImpact(RESERVE0, RESERVE1, FEE, cap)).toBeLessThanOrEqual(thr);
    expect(localImpact(RESERVE0, RESERVE1, FEE, cap + 1n)).toBeGreaterThan(thr);
  });

  it('解析式免二分：tokenIn 对应 token1 时方向解析正确', async () => {
    const RESERVE0 = 2_000_000n; // token0 = tokenOut 的储备
    const RESERVE1 = 1_000_000n; // token1 = tokenIn 的储备
    const FEE = 3000n;
    const THRESHOLD = '0.01';
    const thr = parseDecimal(THRESHOLD, 18n);

    const candidate = makeCandidate(poolA, '90', '0.05');
    candidate.pool.token0 = tokenOut;
    candidate.pool.token1 = tokenIn;
    candidate.quote.reserve0 = RESERVE0.toString();
    candidate.quote.reserve1 = RESERVE1.toString();

    const reference = referenceBinaryCap(RESERVE1, RESERVE0, FEE, thr, 1_000_000n);
    const cap = await binarySearchCap(candidate, THRESHOLD, 1_000_000n);

    expect(cap).toBe(reference);
    expect(classic.getQuote).not.toHaveBeenCalled();
  });

  it('解析式免二分：cap 不超过 upperBound', async () => {
    // 现实量级储备（1e18 wei），避免整数 floor 在极小金额下被量化误差主导
    const RESERVE0 = 10n ** 18n;
    const RESERVE1 = 10n ** 18n;
    const FEE = 3000n;
    const THRESHOLD = '0.01';
    const UPPER = 10n ** 15n; // 解析式 cap 约 7.09e15，UPPER 在其之下且 priceImpact < 阈值

    const candidate = makeCandidate(poolA, '90', '0.05');
    candidate.quote.reserve0 = RESERVE0.toString();
    candidate.quote.reserve1 = RESERVE1.toString();

    const cap = await binarySearchCap(candidate, THRESHOLD, UPPER);

    expect(cap).toBe(UPPER);
    expect(classic.getQuote).not.toHaveBeenCalled();
  });

  it('解析式免二分：储备缺失时回退 RPC 二分（不影响既有行为）', async () => {
    // 无 reserve0/reserve1 的候选（如旧数据或 mock）应回退到 RPC 二分
    const candidate = makeCandidate(poolA, '90', '0.05');
    const capacity: Record<string, bigint> = { [poolA]: 4000n };
    classic.getQuote.mockImplementation((p: { poolAddress: string; amountIn: string }) =>
      Promise.resolve(makeQuote(p.poolAddress, p.amountIn, capacity[p.poolAddress])),
    );

    const cap = await binarySearchCap(candidate, '0.01', 100n);

    // 线性模型 impact = amountIn/4000，阈值 0.01 → cap = 40
    expect(cap).toBe(40n);
    expect(classic.getQuote).toHaveBeenCalled();
  });
});
