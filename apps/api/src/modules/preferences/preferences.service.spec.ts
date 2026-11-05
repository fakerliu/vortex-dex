import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UserPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PreferencesService } from './preferences.service';

const ADDR = '0x1111111111111111111111111111111111111111';
const ADDR_UPPER = '0x1111111111111111111111111111111111111111'.toUpperCase();
const OTHER = '0x2222222222222222222222222222222222222222';

/** 构造 mock user_preferences 行。 */
function makeRow(
  overrides: Partial<Record<string, unknown>> = {},
): UserPreference {
  const base = {
    id: 'pref-1',
    user_address: ADDR,
    default_slippage_bps: 50,
    default_chain_id: 8453,
    default_deadline_sec: 1200,
    notify_alerts: true,
    favorite_tokens: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
  return { ...base, ...overrides } as unknown as UserPreference;
}

describe('PreferencesService', () => {
  let service: PreferencesService;
  let findUnique: jest.Mock;
  let upsert: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    upsert = jest.fn();
    const prisma = {
      userPreference: { findUnique, upsert },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PreferencesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PreferencesService);
  });

  it('getPreference 无记录返回全默认值且不落库', async () => {
    findUnique.mockResolvedValue(null);

    const res = await service.getPreference(ADDR_UPPER);

    expect(res).toEqual({
      userAddress: ADDR,
      defaultSlippageBps: 50,
      defaultChainId: 8453,
      defaultDeadlineSec: 1200,
      notifyAlerts: true,
      favoriteTokens: [],
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { user_address: ADDR } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('updatePreference 无记录时走 upsert create', async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue(
      makeRow({ default_slippage_bps: 100, default_chain_id: 84532 }),
    );

    const res = await service.updatePreference(ADDR, {
      defaultSlippageBps: 100,
      defaultChainId: 84532,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { user_address: ADDR },
      create: {
        user_address: ADDR,
        default_slippage_bps: 100,
        default_chain_id: 84532,
      },
      update: { default_slippage_bps: 100, default_chain_id: 84532 },
    });
    expect(res.defaultSlippageBps).toBe(100);
    expect(res.defaultChainId).toBe(84532);
  });

  it('updatePreference 部分更新时 update 只含传入字段', async () => {
    upsert.mockResolvedValue(makeRow({ default_slippage_bps: 30 }));

    await service.updatePreference(ADDR, { defaultSlippageBps: 30 });

    const arg = upsert.mock.calls[0][0];
    expect(arg.update).toEqual({ default_slippage_bps: 30 });
  });

  it('updatePreference 非法滑点抛 BadRequestException', async () => {
    await expect(
      service.updatePreference(ADDR, { defaultSlippageBps: 10001 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updatePreference(ADDR, { defaultChainId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updatePreference(ADDR, { defaultDeadlineSec: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('addFavorite 重复 address 不重复添加', async () => {
    const existing = JSON.stringify([
      { chainId: 8453, address: ADDR, symbol: 'WETH' },
    ]);
    findUnique.mockResolvedValue(makeRow({ favorite_tokens: existing }));
    upsert.mockResolvedValue(makeRow({ favorite_tokens: existing }));

    const res = await service.addFavorite(ADDR_UPPER, {
      chainId: 8453,
      address: ADDR,
      symbol: 'WETH',
    });

    const written = JSON.parse(upsert.mock.calls[0][0].update.favorite_tokens);
    expect(written).toHaveLength(1);
    expect(written[0].address).toBe(ADDR);
    expect(res.favoriteTokens).toHaveLength(1);
  });

  it('removeFavorite 按 chainId+address 正确移除', async () => {
    const existing = JSON.stringify([
      { chainId: 8453, address: ADDR, symbol: 'WETH' },
      { chainId: 8453, address: OTHER, symbol: 'USDC' },
    ]);
    findUnique.mockResolvedValue(makeRow({ favorite_tokens: existing }));
    upsert.mockResolvedValue(
      makeRow({
        favorite_tokens: JSON.stringify([
          { chainId: 8453, address: OTHER, symbol: 'USDC' },
        ]),
      }),
    );

    const res = await service.removeFavorite(ADDR, ADDR_UPPER, 8453);

    const written = JSON.parse(upsert.mock.calls[0][0].update.favorite_tokens);
    expect(written).toEqual([{ chainId: 8453, address: OTHER, symbol: 'USDC' }]);
    expect(res.favoriteTokens).toEqual([
      { chainId: 8453, address: OTHER, symbol: 'USDC' },
    ]);
  });

  it('addFavorite 跨链同地址代币互不覆盖', async () => {
    const existing = JSON.stringify([
      { chainId: 8453, address: ADDR, symbol: 'WETH' },
    ]);
    findUnique.mockResolvedValue(makeRow({ favorite_tokens: existing }));
    upsert.mockResolvedValue(
      makeRow({
        favorite_tokens: JSON.stringify([
          { chainId: 8453, address: ADDR, symbol: 'WETH' },
          { chainId: 84532, address: ADDR, symbol: 'WETH' },
        ]),
      }),
    );

    const res = await service.addFavorite(ADDR, {
      chainId: 84532,
      address: ADDR,
      symbol: 'WETH',
    });

    const written = JSON.parse(upsert.mock.calls[0][0].update.favorite_tokens);
    expect(written).toHaveLength(2);
    expect(res.favoriteTokens).toHaveLength(2);
  });

  it('removeFavorite 跨链只移除指定链，不误删同地址其他链', async () => {
    const existing = JSON.stringify([
      { chainId: 8453, address: ADDR, symbol: 'WETH' },
      { chainId: 84532, address: ADDR, symbol: 'WETH' },
    ]);
    findUnique.mockResolvedValue(makeRow({ favorite_tokens: existing }));
    upsert.mockResolvedValue(
      makeRow({
        favorite_tokens: JSON.stringify([
          { chainId: 84532, address: ADDR, symbol: 'WETH' },
        ]),
      }),
    );

    const res = await service.removeFavorite(ADDR, ADDR, 8453);

    const written = JSON.parse(upsert.mock.calls[0][0].update.favorite_tokens);
    expect(written).toEqual([{ chainId: 84532, address: ADDR, symbol: 'WETH' }]);
    expect(res.favoriteTokens).toEqual([
      { chainId: 84532, address: ADDR, symbol: 'WETH' },
    ]);
  });
});
