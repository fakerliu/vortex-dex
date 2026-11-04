import { Test } from '@nestjs/testing';
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
