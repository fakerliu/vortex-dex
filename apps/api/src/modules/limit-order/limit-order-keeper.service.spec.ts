import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { LimitOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { DexPoolService } from '../../dex/dex-pool.service';
import type { PoolQuoteCandidate } from '../../dex/dex-pool.service';
import { LimitOrderService } from './limit-order.service';
import { LimitOrderKeeperService } from './limit-order-keeper.service';
import { LIMIT_ORDER_EXECUTOR } from './limit-order-executor';

// 成交前复核只依赖「从 signed_swap_tx 反解 Router」这一纯函数，
// 此处 mock 掉以聚焦 keeper 状态机与幂等（真实反解在 service.spec 中已覆盖）。
jest.mock('./limit-order.signer', () => ({
  ...jest.requireActual('./limit-order.signer'),
  extractSwapTarget: jest.fn(
    () => '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',
  ),
}));

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USER = '0x00000000000000000000000000000000000000aa';

function makeOrder(overrides: Partial<Record<string, unknown>> = {}): LimitOrder {
  const base = {
    id: 'order-1',
    user_address: USER,
    chain_id: 8453,
    direction: 'buy',
    token_in: WETH,
    token_out: USDC,
    amount_in: new Prisma.Decimal('1000000000000000000'),
    min_amount_out: new Prisma.Decimal('2500000000'),
    limit_price: new Prisma.Decimal('0.0004'),
    slippage_bps: 0,
    status: 'pending',
    expires_at: new Date('2030-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    triggered_at: null,
    filled_at: null,
    swap_id: null,
    tx_hash: null,
    failure_reason: null,
    signed_swap_tx: `0x02${'00'.repeat(100)}`, // 占位 raw hex（仅测试 extractSwapTarget 被 mock 绕过时用）
    signed_approval_tx: null,
    settlement_contract: null,
    order_nonce: null,
    eip712_signature: null,
    fill_kind: 'fill_or_kill',
  };
  return { ...base, ...overrides } as unknown as LimitOrder;
}

function makeQuote(amountOut: string): PoolQuoteCandidate {
  return {
    pool: {} as never,
    protocolType: 'aerodrome_classic',
    quote: { amountOut },
    gas: { gasLimit: '250000', source: 'static', estimated: true },
  } as unknown as PoolQuoteCandidate;
}

describe('LimitOrderKeeperService', () => {
  let keeper: LimitOrderKeeperService;

  // prisma
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let updateMany: jest.Mock;
  // deps
  let quoteBestForChain: jest.Mock;
  let readBalance: jest.Mock;
  let readAllowance: jest.Mock;
  let claimTriggered: jest.Mock;
  let recordTxHash: jest.Mock;
  let markFilled: jest.Mock;
  let markFailed: jest.Mock;
  let notify: jest.Mock;
  let fill: jest.Mock;
  let reconcile: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    findUnique = jest.fn();
    updateMany = jest.fn();
    quoteBestForChain = jest.fn();
    readBalance = jest.fn();
    readAllowance = jest.fn();
    claimTriggered = jest.fn();
    recordTxHash = jest.fn().mockResolvedValue(undefined);
    markFilled = jest.fn().mockResolvedValue(undefined);
    markFailed = jest.fn().mockResolvedValue(undefined);
    notify = jest.fn().mockResolvedValue(undefined);
    fill = jest.fn();
    reconcile = jest.fn();

    const prisma = {
      limitOrder: { findMany, findUnique, updateMany },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LimitOrderKeeperService,
        { provide: PrismaService, useValue: prisma },
        { provide: DexPoolService, useValue: { quoteBestForChain } },
        { provide: Erc20ReaderService, useValue: { readBalance, readAllowance } },
        {
          provide: LimitOrderService,
          useValue: {
            claimTriggered,
            recordTxHash,
            markFilled,
            markFailed,
            notify,
          },
        },
        {
          provide: LIMIT_ORDER_EXECUTOR,
          useValue: { fill, reconcile },
        },
      ],
    }).compile();
    keeper = moduleRef.get(LimitOrderKeeperService);
  });

  it('CAS 幂等：双实例竞争，未抢到 pending->triggered 的实例不广播（只成交一次）', async () => {
    const order = makeOrder();
    findMany.mockResolvedValue([order]);
    quoteBestForChain.mockResolvedValue(makeQuote('2500000000')); // 已满足限价
    claimTriggered.mockResolvedValue(false); // 被另一实例抢走

    const summary = await keeper.scanAndFill();

    expect(summary.skipped).toBe(1);
    expect(summary.triggered).toBe(0);
    expect(summary.filled).toBe(0);
    expect(fill).not.toHaveBeenCalled();
    expect(recordTxHash).not.toHaveBeenCalled();
  });

  it('CAS 抢到 + 广播 + 回执成功 -> filled', async () => {
    const order = makeOrder();
    const triggered = makeOrder({ status: 'triggered', signed_swap_tx: '0x02abc' });
    findMany.mockResolvedValue([order]);
    quoteBestForChain.mockResolvedValue(makeQuote('2600000000'));
    claimTriggered.mockResolvedValue(true);
    findUnique
      .mockResolvedValueOnce(triggered) // CAS 后重读
      .mockResolvedValueOnce({ ...triggered, tx_hash: '0x' + 'a'.repeat(64) }); // 广播后重读
    readBalance.mockResolvedValue(10n ** 18n);
    readAllowance.mockResolvedValue(10n ** 18n);
    fill.mockResolvedValue({ txHash: '0x' + 'a'.repeat(64) });
    reconcile.mockResolvedValue({ status: 'filled' });

    const summary = await keeper.scanAndFill();

    expect(summary.filled).toBe(1);
    expect(fill).toHaveBeenCalledTimes(1);
    expect(markFilled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      '0x' + 'a'.repeat(64),
      '2600000000',
    );
  });

  it('广播前余额不足 -> failed（不广播注定 revert 的交易）', async () => {
    const order = makeOrder();
    const triggered = makeOrder({ status: 'triggered', signed_swap_tx: '0x02abc' });
    findMany.mockResolvedValue([order]);
    quoteBestForChain.mockResolvedValue(makeQuote('2600000000'));
    claimTriggered.mockResolvedValue(true);
    findUnique.mockResolvedValue(triggered);
    readBalance.mockResolvedValue(1n); // 余额不足
    readAllowance.mockResolvedValue(10n ** 18n);

    const summary = await keeper.scanAndFill();

    expect(summary.failed).toBe(1);
    expect(fill).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      '余额不足',
    );
  });

  it('过期清扫：pending + expires_at < now -> expired 并通知', async () => {
    const expiredRow = makeOrder({
      id: 'order-2',
      status: 'expired',
      expires_at: new Date('2020-01-01T00:00:00Z'),
    });
    findMany.mockResolvedValue([{ id: 'order-2' }]);
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue(expiredRow);

    const swept = await keeper.sweepExpired();

    expect(swept).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'order-2', status: 'pending' },
      data: { status: 'expired' },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-2' }),
      'limit_order_expired',
      '限价单已过期',
    );
  });

  it('runCycle 防重入：running 时直接返回空结果', async () => {
    // 直接置 running=true 模拟并发
    (keeper as unknown as { running: boolean }).running = true;

    const result = await keeper.runCycle();

    expect(result.sweptExpired).toBe(0);
    expect(result.filled).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
