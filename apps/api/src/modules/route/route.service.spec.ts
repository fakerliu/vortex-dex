import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { DexPoolService } from '../../dex/dex-pool.service';
import { EventCollectorService } from '../analytics/event-collector.service';
import { RouteService } from './route.service';

const WETH = '0x4200000000000000000000000000000000000006';

/** RouteHop 是私有接口，测试里用结构化对象 + as any 绕过。 */
function hop(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    pool: '0x00000000000000000000000000000000000000aa',
    kind: 'cl',
    protocolType: 'aerodrome_cl',
    tokenIn: '0x0000000000000000000000000000000000000001',
    tokenOut: '0x0000000000000000000000000000000000000002',
    amountIn: '1000',
    amountOut: 2000n,
    fee: '3000',
    priceImpact: '0.1',
    source: 'quoter',
    gasEstimate: 1000n,
    ...partial,
  };
}

describe('RouteService 聚合逻辑', () => {
  let service: RouteService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RouteService,
        { provide: PrismaService, useValue: {} },
        { provide: ChainRpcService, useValue: {} },
        { provide: DexPoolService, useValue: {} },
        { provide: EventCollectorService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(RouteService);
  });

  // 私有方法通过 as any 访问（纯函数，不访问 this）
  const toPath = (hops: unknown[], amountIn: string): Record<string, unknown> =>
    (service as unknown as { toPath(h: unknown[], a: string): Record<string, unknown> }).toPath(
      hops,
      amountIn,
    );

  describe('toPath', () => {
    it('tokenPath 拼接：首 token + 每跳 tokenOut', () => {
      const h1 = hop({
        tokenIn: '0xaaa',
        tokenOut: '0xbbb',
      });
      const h2 = hop({
        tokenIn: '0xbbb',
        tokenOut: '0xccc',
      });
      const p = toPath([h1, h2], '1000');

      expect(p.tokenPath).toEqual(['0xaaa', '0xbbb', '0xccc']);
    });

    it('estimatedGas 累加、amountOut 取末跳', () => {
      const h1 = hop({ gasEstimate: 1000n, amountOut: 2000n });
      const h2 = hop({ gasEstimate: 2500n, amountOut: 3900n });
      const p = toPath([h1, h2], '1000');

      expect(p.estimatedGas).toBe(3500n);
      expect(p.amountOut).toBe(3900n);
    });

    it('priceImpact 用 combinePriceImpacts 组合（0.1+0.1 → 0.19）', () => {
      const h1 = hop({ priceImpact: '0.1' });
      const h2 = hop({ priceImpact: '0.1' });
      const p = toPath([h1, h2], '1000');

      expect(p.priceImpact).toBe('0.19');
    });

    it('poolPath / protocolPath 逐跳映射', () => {
      const h1 = hop({ pool: '0xpool1', protocolType: 'aerodrome_classic' });
      const h2 = hop({ pool: '0xpool2', protocolType: 'aerodrome_cl' });
      const p = toPath([h1, h2], '1000');

      expect(p.poolPath).toEqual(['0xpool1', '0xpool2']);
      expect(p.protocolPath).toEqual(['aerodrome_classic', 'aerodrome_cl']);
    });
  });

  describe('computeEthToTokenRate（tokenOut === WETH 分支）', () => {
    it('返回 rateNum=1n, rateDen=1n（与 ETH 1:1）', async () => {
      const rate = await (
        service as unknown as {
          computeEthToTokenRate(
            chainId: number,
            tokenOut: string,
            useClassic: boolean,
            useCl: boolean,
          ): Promise<Record<string, unknown>>;
        }
      ).computeEthToTokenRate(8453, WETH, true, true);

      expect(rate.rateNum).toBe(1n);
      expect(rate.rateDen).toBe(1n);
      expect(rate.path).toEqual([WETH]);
      expect(rate.uncertain).toBe(false);
      expect(String(rate.method)).toContain('1:1');
    });
  });
});
