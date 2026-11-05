import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { LimitOrder } from '@prisma/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { SwapService } from '../swap/swap.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher';
import { AERODROME_CLASSIC_ROUTER } from '../../dex/aerodrome/constants';
import { AERODROME_PROTOCOL_TYPE_CLASSIC } from '../../dex/aerodrome/constants';
import { LimitOrderService } from './limit-order.service';
import {
  buildSwapTransaction,
  decodeSwapData,
  deriveMinAmountOut,
  verifySignedApproval,
  verifySignedSwap,
} from './limit-order.signer';
import type { SwapHopDto } from '../swap/swap.types';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USER = '0x00000000000000000000000000000000000000aa';

const EXPIRES_AT = new Date('2030-01-01T00:00:00Z');

function makeClassicHop(overrides: Partial<SwapHopDto> = {}): SwapHopDto {
  return {
    pool: '0x0000000000000000000000000000000000000011',
    protocol: AERODROME_PROTOCOL_TYPE_CLASSIC,
    kind: 'classic-volatile',
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: '1000000000000000000',
    amountOut: '2500000000',
    fee: '30',
    stable: false,
    ...overrides,
  };
}

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
    expires_at: EXPIRES_AT,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    triggered_at: null,
    filled_at: null,
    swap_id: null,
    tx_hash: null,
    failure_reason: null,
    signed_swap_tx: null,
    signed_approval_tx: null,
    settlement_contract: null,
    order_nonce: null,
    eip712_signature: null,
    fill_kind: 'fill_or_kill',
  };
  return { ...base, ...overrides } as unknown as LimitOrder;
}

async function signEip1559(
  account: ReturnType<typeof privateKeyToAccount>,
  params: { to: string; data: string; nonce: number },
): Promise<string> {
  return account.signTransaction({
    type: 'eip1559',
    chainId: 8453,
    to: params.to as Address,
    value: 0n,
    data: params.data as Hex,
    nonce: params.nonce,
    gas: 250000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
  });
}

describe('deriveMinAmountOut（BigInt floor，禁 Float）', () => {
  it('精确整除', () => {
    // 1 WETH(18) 按 0.0004 WETH/USDC 换 USDC(6) => 2500 USDC = 2.5e9 raw
    expect(deriveMinAmountOut(10n ** 18n, '0.0004', 18, 6)).toBe(
      2_500_000_000n,
    );
  });

  it('向下取整（floor）', () => {
    // 100 / 3 = 33.33... -> floor 33
    expect(deriveMinAmountOut(100n, '3', 0, 0)).toBe(33n);
  });

  it('limitPrice 越小，min_amount_out 越大（买单语义）', () => {
    const low = deriveMinAmountOut(10n ** 18n, '0.0004', 18, 6);
    const high = deriveMinAmountOut(10n ** 18n, '0.0002', 18, 6);
    expect(high).toBeGreaterThan(low);
  });
});

describe('签名校验（viem recoverTransactionAddress + calldata 比对）', () => {
  const amountIn = '1000000000000000000';
  const minAmountOut = '2500000000';
  const deadline = Math.floor(EXPIRES_AT.getTime() / 1000);

  function buildSwap(recipient: string): { to: string; data: string } {
    const tx = buildSwapTransaction(
      [makeClassicHop()],
      recipient,
      amountIn,
      minAmountOut,
      deadline,
    );
    return { to: tx.to, data: tx.data };
  }

  it('本人签名 + 内容一致 -> 通过并返回 to/selector', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const ownerAddress = owner.address.toLowerCase();
    const { to, data } = buildSwap(ownerAddress);
    const signed = await signEip1559(owner, { to, data, nonce: 0 });

    const result = await verifySignedSwap(signed, {
      chainId: 8453,
      userAddress: ownerAddress,
      amountIn,
      minAmountOut,
      expiresAt: EXPIRES_AT,
    });
    expect(result.to).toBe(AERODROME_CLASSIC_ROUTER.toLowerCase());
    expect(result.selector).toBe('0xcac88ea9');
  });

  it('拒绝非本人签名（recover 地址 != userAddress）', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const ownerAddress = owner.address.toLowerCase();
    const { to, data } = buildSwap(ownerAddress);
    const signedByAttacker = await signEip1559(attacker, { to, data, nonce: 0 });

    await expect(
      verifySignedSwap(signedByAttacker, {
        chainId: 8453,
        userAddress: ownerAddress,
        amountIn,
        minAmountOut,
        expiresAt: EXPIRES_AT,
      }),
    ).rejects.toThrow('签名者与 userAddress 不一致');
  });

  it('拒绝 calldata 内容不符（amountOutMin 被篡改）', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const ownerAddress = owner.address.toLowerCase();
    const tampered = buildSwapTransaction(
      [makeClassicHop()],
      ownerAddress,
      amountIn,
      '999999', // 被篡改的 amountOutMin
      deadline,
    );
    const signed = await signEip1559(owner, {
      to: tampered.to,
      data: tampered.data,
      nonce: 0,
    });

    await expect(
      verifySignedSwap(signed, {
        chainId: 8453,
        userAddress: ownerAddress,
        amountIn,
        minAmountOut,
        expiresAt: EXPIRES_AT,
      }),
    ).rejects.toThrow('calldata amountOutMin 与订单不符');
  });

  it('拒绝 recipient 被篡改', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const ownerAddress = owner.address.toLowerCase();
    const tampered = buildSwapTransaction(
      [makeClassicHop()],
      '0x00000000000000000000000000000000000000bb', // 他人收款
      amountIn,
      minAmountOut,
      deadline,
    );
    const signed = await signEip1559(owner, {
      to: tampered.to,
      data: tampered.data,
      nonce: 0,
    });

    await expect(
      verifySignedSwap(signed, {
        chainId: 8453,
        userAddress: ownerAddress,
        amountIn,
        minAmountOut,
        expiresAt: EXPIRES_AT,
      }),
    ).rejects.toThrow('calldata recipient 与订单不符');
  });

  it('approve 校验：spender 是已知 Router 且额度 >= amountIn', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const ownerAddress = owner.address.toLowerCase();
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [AERODROME_CLASSIC_ROUTER as Address, BigInt(amountIn)],
    });
    const signed = await signEip1559(owner, {
      to: WETH,
      data: approveData,
      nonce: 0,
    });

    await expect(
      verifySignedApproval(signed, {
        chainId: 8453,
        userAddress: ownerAddress,
        tokenIn: WETH,
        amountIn,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('LimitOrderService', () => {
  let service: LimitOrderService;

  describe('createOrder', () => {
    let prepare: jest.Mock;
    let create: jest.Mock;
    let upsert: jest.Mock;
    let getTransactionCount: jest.Mock;
    let estimateFeesPerGas: jest.Mock;

    beforeEach(async () => {
      prepare = jest.fn().mockResolvedValue({
        chainId: 8453,
        userAddress: USER,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: '1000000000000000000',
        amountOut: '2500000000',
        minimumReceived: '2500000000',
        priceImpact: '0',
        slippageBps: 0,
        deadline: 123,
        protocol: AERODROME_PROTOCOL_TYPE_CLASSIC,
        route: [makeClassicHop()],
        balance: '1000000000000000000',
        allowance: '0',
        spender: AERODROME_CLASSIC_ROUTER.toLowerCase(),
        needsApproval: true,
        approvalAmount: '1000000000000000000',
        transaction: {
          to: AERODROME_CLASSIC_ROUTER.toLowerCase(),
          value: '0',
          data: '0xdeadbeef',
          functionName: 'swapExactTokensForTokens',
          selector: '0xcac88ea9',
          gasLimit: '250000',
        },
        approval: {
          needed: true,
          token: WETH,
          spender: AERODROME_CLASSIC_ROUTER.toLowerCase(),
          amount: '1000000000000000000',
          data: '0x095ea7b3',
          functionName: 'approve',
          selector: '0x095ea7b3',
        },
        quoteTimestamp: '2026-01-01T00:00:00Z',
        notes: [],
      });
      create = jest.fn().mockResolvedValue(makeOrder());
      upsert = jest.fn().mockResolvedValue({});
      getTransactionCount = jest.fn().mockResolvedValue(5);
      estimateFeesPerGas = jest.fn().mockResolvedValue({
        maxFeePerGas: 100_000_000n,
        maxPriorityFeePerGas: 1_000_000n,
      });

      const prisma = {
        user: { upsert },
        limitOrder: { create },
      };
      const rpc = {
        getClient: jest.fn().mockReturnValue({
          getTransactionCount,
          estimateFeesPerGas,
        }),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          LimitOrderService,
          { provide: PrismaService, useValue: prisma },
          { provide: SwapService, useValue: { prepare } },
          { provide: ChainRpcService, useValue: rpc },
          { provide: NotificationDispatcher, useValue: { dispatch: jest.fn() } },
        ],
      }).compile();
      service = moduleRef.get(LimitOrderService);
    });

    it('派生 min_amount_out 并以限价单语义组装 signingPayload', async () => {
      const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 7 天上界内
      const expectedDeadline = BigInt(Math.floor(expiresAt.getTime() / 1000));

      const result = await service.createOrder({
        userAddress: USER,
        chainId: 8453,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: '1000000000000000000',
        limitPrice: '0.0004',
        slippageBps: 0,
        expiresAt: expiresAt.toISOString(),
      });

      // 落库的 min_amount_out 为权威限价
      const created = create.mock.calls[0][0].data;
      expect(created.min_amount_out.toString()).toBe('2500000000');
      expect(created.status).toBe('pending');

      // signingPayload：approve(nonce=5) -> swap(nonce=6)，连续
      const txs = result.signingPayload.transactions;
      expect(txs).toHaveLength(2);
      expect(txs[0].kind).toBe('approve');
      expect(txs[0].to).toBe(WETH);
      expect(txs[0].nonce).toBe(5);
      expect(txs[1].kind).toBe('swap');
      expect(txs[1].nonce).toBe(6);

      // swap calldata 用限价单语义：amountOutMin=min_amount_out, deadline=expires_at, recipient=user
      const fields = decodeSwapData(8453, txs[1].data);
      expect(fields.amountOutMin).toBe(2500000000n);
      expect(fields.deadline).toBe(expectedDeadline);
      expect(fields.recipient).toBe(USER);
    });
  });

  describe('submitSignature（真实签名）', () => {
    let findUnique: jest.Mock;
    let updateMany: jest.Mock;

    beforeEach(async () => {
      findUnique = jest.fn();
      updateMany = jest.fn();
      const prisma = {
        limitOrder: { findUnique, updateMany },
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          LimitOrderService,
          { provide: PrismaService, useValue: prisma },
          { provide: SwapService, useValue: {} },
          { provide: ChainRpcService, useValue: {} },
          { provide: NotificationDispatcher, useValue: { dispatch: jest.fn() } },
        ],
      }).compile();
      service = moduleRef.get(LimitOrderService);
    });

    it('本人签名 + 内容一致 -> 武装订单（armed）', async () => {
      const owner = privateKeyToAccount(generatePrivateKey());
      const ownerAddress = owner.address.toLowerCase();
      const order = makeOrder({ user_address: ownerAddress });
      findUnique
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, signed_swap_tx: '0xabc' });
      updateMany.mockResolvedValue({ count: 1 });

      const tx = buildSwapTransaction(
        [makeClassicHop()],
        ownerAddress,
        '1000000000000000000',
        '2500000000',
        Math.floor(EXPIRES_AT.getTime() / 1000),
      );
      const signed = await signEip1559(owner, {
        to: tx.to,
        data: tx.data,
        nonce: 0,
      });

      const result = await service.submitSignature('order-1', {
        userAddress: ownerAddress,
        signedSwapTx: signed,
      });

      expect(result.armed).toBe(true);
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ signed_swap_tx: null }),
        }),
      );
    });

    it('拒绝非本人签名', async () => {
      const owner = privateKeyToAccount(generatePrivateKey());
      const attacker = privateKeyToAccount(generatePrivateKey());
      const order = makeOrder({ user_address: owner.address.toLowerCase() });
      findUnique.mockResolvedValue(order);

      const tx = buildSwapTransaction(
        [makeClassicHop()],
        owner.address.toLowerCase(),
        '1000000000000000000',
        '2500000000',
        Math.floor(EXPIRES_AT.getTime() / 1000),
      );
      const signedByAttacker = await signEip1559(attacker, {
        to: tx.to,
        data: tx.data,
        nonce: 0,
      });

      await expect(
        service.submitSignature('order-1', {
          userAddress: owner.address.toLowerCase(),
          signedSwapTx: signedByAttacker,
        }),
      ).rejects.toThrow('签名者与 userAddress 不一致');
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrder（CAS + 属主校验）', () => {
    let updateMany: jest.Mock;
    let findUnique: jest.Mock;

    beforeEach(async () => {
      updateMany = jest.fn();
      findUnique = jest.fn();
      const prisma = { limitOrder: { updateMany, findUnique } };

      const moduleRef = await Test.createTestingModule({
        providers: [
          LimitOrderService,
          { provide: PrismaService, useValue: prisma },
          { provide: SwapService, useValue: {} },
          { provide: ChainRpcService, useValue: {} },
          { provide: NotificationDispatcher, useValue: { dispatch: jest.fn() } },
        ],
      }).compile();
      service = moduleRef.get(LimitOrderService);
    });

    it('pending + 属主一致 -> 撤单成功', async () => {
      updateMany.mockResolvedValue({ count: 1 });
      findUnique.mockResolvedValue(
        makeOrder({ status: 'cancelled' }),
      );

      const result = await service.cancelOrder('order-1', USER);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', user_address: USER, status: 'pending' },
        data: { status: 'cancelled' },
      });
      expect(result.status).toBe('cancelled');
    });

    it('属主不一致 -> 404（不可跨用户撤单）', async () => {
      updateMany.mockResolvedValue({ count: 0 });
      findUnique.mockResolvedValue(makeOrder());

      await expect(
        service.cancelOrder('order-1', '0x00000000000000000000000000000000000000bb'),
      ).rejects.toThrow('限价单不存在');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_address: '0x00000000000000000000000000000000000000bb',
          }),
        }),
      );
    });

    it('非 pending 状态 -> 409', async () => {
      updateMany.mockResolvedValue({ count: 0 });
      findUnique.mockResolvedValue(makeOrder({ status: 'filled' }));

      await expect(service.cancelOrder('order-1', USER)).rejects.toThrow(
        '不可撤单',
      );
    });
  });
});
