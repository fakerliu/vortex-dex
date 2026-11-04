import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Quote } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { DexPoolService } from '../../dex/dex-pool.service';
import { EventCollectorService } from '../analytics/event-collector.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { QuoteService } from './quote.service';

/** 构造一个满足 toQuoteResponseDto 所需字段的 mock Quote 行。 */
function makeQuoteRow(overrides: Partial<Record<string, unknown>> = {}): Quote {
  const now = Date.now();
  const base = {
    id: 'quote-1',
    chain_id: 8453,
    token_in: '0x0000000000000000000000000000000000000001',
    token_out: '0x0000000000000000000000000000000000000002',
    amount_in: '1000000000000000000',
    amount_out: '2000000000000000000000',
    price: '2000',
    minimum_received: '1990000000000000000000',
    price_impact: '0.001',
    swap_fee: '3000',
    gas_estimate: '150000',
    protocol: 'aerodrome_classic',
    route: JSON.stringify([{ pool: '0x0000000000000000000000000000000000000003', kind: 'classic-volatile' }]),
    source: 'constant-product',
    block_number: 12345,
    created_at: new Date(now),
    expires_at: new Date(now + 60_000),
    intent_id: null,
    user_address: null,
    response_ms: 12,
  };
  return { ...base, ...overrides } as unknown as Quote;
}

describe('QuoteService.getQuote 过期保护', () => {
  let service: QuoteService;
  let findUnique: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    const prisma = { quote: { findUnique } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuoteService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChainRpcService, useValue: {} },
        { provide: Erc20ReaderService, useValue: {} },
        { provide: DexPoolService, useValue: {} },
        { provide: EventCollectorService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(QuoteService);
  });

  it('quote 不存在 → NotFoundException', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.getQuote('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'missing-id' },
    });
  });

  it('expires_at 为过去时间 → HttpException(410 QUOTE_EXPIRED)', async () => {
    findUnique.mockResolvedValue(
      makeQuoteRow({ expires_at: new Date(Date.now() - 60_000) }),
    );

    const err = await service.getQuote('expired-id').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.GONE); // 410
    expect((err as HttpException).getResponse()).toMatchObject({
      code: ErrorCodes.QUOTE_EXPIRED,
    });
  });

  it('expires_at 为未来时间 → 正常返回 DTO', async () => {
    const row = makeQuoteRow({ expires_at: new Date(Date.now() + 60_000) });
    findUnique.mockResolvedValue(row);

    const dto = await service.getQuote('valid-id');

    expect(dto.id).toBe('quote-1');
    expect(dto.chainId).toBe(8453);
    expect(dto.amountIn).toBe('1000000000000000000');
    expect(dto.amountOut).toBe('2000000000000000000000');
    expect(dto.protocol).toBe('aerodrome_classic');
    expect(dto.swapFeeFraction).toBe('0.003');
  });
});
