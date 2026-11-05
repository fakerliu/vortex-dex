import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { DexPoolService } from '../../dex/dex-pool.service';
import { AerodromeClassicAdapter } from '../../dex/aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from '../../dex/aerodrome/aerodrome-cl.adapter';
import { UniswapV3Adapter } from '../../dex/uniswap-v3/uniswap-v3.adapter';
import { EventCollectorService } from '../analytics/event-collector.service';
import { SwapService } from './swap.service';

describe('SwapService.extractRevertReason（revert 分类）', () => {
  let service: SwapService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SwapService,
        { provide: PrismaService, useValue: {} },
        { provide: ChainRpcService, useValue: {} },
        { provide: Erc20ReaderService, useValue: {} },
        { provide: DexPoolService, useValue: {} },
        { provide: AerodromeClassicAdapter, useValue: {} },
        { provide: AerodromeClAdapter, useValue: {} },
        { provide: UniswapV3Adapter, useValue: {} },
        { provide: EventCollectorService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(SwapService);
  });

  // extractRevertReason 是私有方法，通过 as any 绕过可见性（纯函数，不访问 this）
  const extract = (err: unknown): string =>
    (service as unknown as { extractRevertReason(e: unknown): string }).extractRevertReason(err);

  it('cause.reason 存在 → 直接返回该 reason', () => {
    expect(extract({ cause: { reason: 'INSUFFICIENT_OUTPUT_AMOUNT' } })).toBe(
      'INSUFFICIENT_OUTPUT_AMOUNT',
    );
  });

  it('shortMessage 含 revert 描述 → 正则提取', () => {
    expect(
      extract({ shortMessage: 'execution reverted: panic code 0x11' }),
    ).toBe('panic code 0x11');
  });

  it('cause.data 为十六进制 → 返回 revert data=...', () => {
    const data = '0x08c379a0' + '0'.repeat(64);
    expect(extract({ cause: { data } })).toBe(`revert data=${data}`);
  });

  it('空对象 → REVERTED', () => {
    expect(extract({})).toBe('REVERTED');
  });

  it('无 reason 但有 message（非 revert 前缀）→ 返回 message', () => {
    expect(extract({ message: 'some other error' })).toBe('some other error');
  });
});

describe('SwapService.getSwapByTxHash（按 txHash 查询）', () => {
  let service: SwapService;
  let findUnique: jest.Mock;

  const TX_HASH = '0x' + 'a'.repeat(64);

  beforeEach(async () => {
    findUnique = jest.fn();
    const prismaMock = {
      swap: { findUnique },
      swapEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const rpcMock = {
      getClient: jest.fn().mockReturnValue({
        getTransactionReceipt: jest.fn().mockResolvedValue(null),
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SwapService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChainRpcService, useValue: rpcMock },
        { provide: Erc20ReaderService, useValue: {} },
        { provide: DexPoolService, useValue: {} },
        { provide: AerodromeClassicAdapter, useValue: {} },
        { provide: AerodromeClAdapter, useValue: {} },
        { provide: UniswapV3Adapter, useValue: {} },
        { provide: EventCollectorService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(SwapService);
  });

  it('找不到 → 抛 NotFoundException', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getSwapByTxHash(TX_HASH)).rejects.toThrow(
      `交易不存在（txHash=${TX_HASH}）`,
    );
  });

  it('找到 → 规范化 txHash 后按 tx_hash 查询并复用 buildSwapDetail', async () => {
    const upper = '0x' + 'A'.repeat(64);
    const row = {
      id: 'swap_1',
      user_address: '0x' + '1'.repeat(40),
      token_in: '0x' + '2'.repeat(40),
      token_out: '0x' + '3'.repeat(40),
      amount_in: new Prisma.Decimal('1000'),
      amount_out: new Prisma.Decimal('2000'),
      tx_hash: TX_HASH,
      status: 'CONFIRMED',
      chain_id: 8453,
      created_at: new Date('2024-01-01T00:00:00Z'),
      confirmed_at: new Date('2024-01-01T00:00:01Z'),
      intent_id: null,
      quote_id: null,
      failure_reason: null,
      gas_used: null,
      effective_gas_price: null,
    };
    findUnique.mockResolvedValue(row);

    const detail = await service.getSwapByTxHash(upper);

    expect(findUnique).toHaveBeenCalledWith({ where: { tx_hash: TX_HASH } });
    expect(detail.id).toBe('swap_1');
    expect(detail.txHash).toBe(TX_HASH);
    expect(detail.explorerUrl).toContain(TX_HASH);
  });
});
