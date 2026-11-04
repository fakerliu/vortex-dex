import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { ChainReadError } from '../../chain/chain.errors';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DexPoolService } from '../../dex/dex-pool.service';
import {
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
} from '../../dex/aerodrome/constants';
import { formatPrice, parseAmount } from '../../dex/math';
import type { QuoteRequestDto, QuoteResponseDto } from './quote.types';
import { toQuoteResponseDto } from './quote.types';

const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
const DEFAULT_QUOTE_TTL_MS = 30_000; // 30s
const MAX_SLIPPAGE_BPS = 10_000; // 100%

/**
 * 报价引擎（Sprint 4）：单跳/直接池报价聚合与最优选择。
 *
 * - 复用 DexPoolService（发现池 + 逐池报价）与 ChainRpcService/Erc20Reader。
 * - 不做多跳路径搜索（Sprint 5 路由引擎）。
 * - 金额 BigInt/Decimal 字符串，禁 Float；结果入库 quotes 表。
 */
@Injectable()
export class QuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: ChainRpcService,
    private readonly erc20: Erc20ReaderService,
    private readonly poolService: DexPoolService,
  ) {}

  async createQuote(req: QuoteRequestDto): Promise<QuoteResponseDto> {
    const chainId = this.resolveChainId(req.chainId);
    const tokenIn = this.assertAddress(req.tokenIn, 'tokenIn');
    const tokenOut = this.assertAddress(req.tokenOut, 'tokenOut');
    if (tokenIn === tokenOut) {
      throw new BadRequestException('tokenIn 与 tokenOut 不能相同');
    }
    if (!/^\d+$/.test(req.amountIn.trim())) {
      throw new BadRequestException(
        'amountIn 必须为正整数字符串（链上原始单位，无小数）',
      );
    }
    const amountIn = parseAmount(req.amountIn);
    if (amountIn <= 0n) {
      throw new BadRequestException('amountIn 必须为正整数（链上原始单位）');
    }
    const slippageBps = this.normalizeSlippageBps(req.slippageBps);
    if (req.maxPathLength !== undefined && req.maxPathLength !== 1) {
      throw new BadRequestException(
        'Sprint 4 仅支持单跳路径（maxPathLength=1）；多跳路由属 Sprint 5',
      );
    }

    // 1. Token 校验 + decimals（DB 优先，缺失则链上读取）
    const [decimalsIn, decimalsOut] = await Promise.all([
      this.resolveDecimals(chainId, tokenIn),
      this.resolveDecimals(chainId, tokenOut),
    ]);

    // 2. 发现可用池（按协议白名单过滤）
    const useClassic = this.protocolAllowed(req.protocols, AERODROME_PROTOCOL_TYPE_CLASSIC);
    const useCl = this.protocolAllowed(req.protocols, AERODROME_PROTOCOL_TYPE_CL);
    let classicPools;
    let clPools;
    try {
      ({ classicPools, clPools } = await this.poolService.discoverPools(
        tokenIn,
        tokenOut,
        useClassic,
        useCl,
      ));
    } catch (err) {
      throw this.toRpcException(err);
    }

    // 3. 逐池报价（单池失败跳过，不拖垮整体）
    const candidates = await this.poolService.quotePair(
      chainId,
      tokenIn,
      tokenOut,
      req.amountIn,
      classicPools,
      clPools,
    );

    if (candidates.length === 0) {
      throw new HttpException(
        {
          code: ErrorCodes.NO_ROUTE,
          message: `无可用流动性池或所有池报价失败（${tokenIn} -> ${tokenOut}，chain=${chainId}）`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // 4. 选最优（最大 amountOut）
    const best = candidates.reduce((a, b) =>
      BigInt(a.quote.amountOut) >= BigInt(b.quote.amountOut) ? a : b,
    );

    // 5. 派生字段（全部 BigInt / 字符串）
    const amountOut = BigInt(best.quote.amountOut);
    const price = formatPrice(amountIn, decimalsIn, amountOut, decimalsOut);
    const minimumReceived =
      (amountOut * (10_000n - BigInt(slippageBps))) / 10_000n;
    const gasEstimate = best.quote.gasEstimate ?? best.gas.gasLimit;
    const blockNumber = await this.readBlockNumber(chainId);
    const now = Date.now();
    const expiresAt = new Date(now + this.quoteTtlMs());

    // 6. 入库 quotes 表（金额 Decimal、price_impact Decimal(78,18)）
    const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
    const row = await this.prisma.quote.create({
      data: {
        chain_id: chainId,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: d(req.amountIn),
        amount_out: d(amountOut.toString()),
        gas_estimate: d(gasEstimate),
        price_impact: d(best.quote.priceImpact || '0'),
        price,
        minimum_received: d(minimumReceived.toString()),
        swap_fee: best.quote.fee,
        protocol: best.protocolType,
        route: JSON.stringify(best.quote.route),
        source: best.quote.source,
        block_number: blockNumber,
        expires_at: expiresAt,
      },
    });

    return toQuoteResponseDto(row);
  }

  async getQuote(id: string): Promise<QuoteResponseDto> {
    const row = await this.prisma.quote.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`报价不存在（id=${id}）`);
    }
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
      throw new HttpException(
        {
          code: ErrorCodes.QUOTE_EXPIRED,
          message: `报价已过期（expires_at=${row.expires_at.toISOString()}）`,
        },
        HttpStatus.GONE,
      );
    }
    return toQuoteResponseDto(row);
  }

  // ---------- 私有 ----------

  private resolveChainId(chainId?: number): number {
    if (chainId === undefined) {
      return BASE_MAINNET_CHAIN_ID;
    }
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
    return chainId;
  }

  private assertAddress(address: string, label: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`${label} 不是合法的 EVM 地址: ${address}`);
    }
    return normalizeAddress(address);
  }

  private normalizeSlippageBps(slippageBps?: number): number {
    const s = slippageBps ?? this.defaultSlippageBps();
    if (!Number.isInteger(s) || s < 0 || s > MAX_SLIPPAGE_BPS) {
      throw new BadRequestException(
        `slippageBps 必须是 0~${MAX_SLIPPAGE_BPS} 的整数（1 bps = 0.01%）`,
      );
    }
    return s;
  }

  private defaultSlippageBps(): number {
    const raw = Number(process.env.DEFAULT_SLIPPAGE_BPS ?? DEFAULT_SLIPPAGE_BPS);
    return Number.isInteger(raw) && raw >= 0 && raw <= MAX_SLIPPAGE_BPS
      ? raw
      : DEFAULT_SLIPPAGE_BPS;
  }

  private quoteTtlMs(): number {
    const raw = Number(process.env.QUOTE_TTL_MS ?? DEFAULT_QUOTE_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUOTE_TTL_MS;
  }

  private protocolAllowed(
    protocols: string[] | undefined,
    protocolType: string,
  ): boolean {
    if (!protocols || protocols.length === 0) {
      return true;
    }
    return protocols.map((p) => p.toLowerCase()).includes(protocolType);
  }

  /** 读取 token decimals：DB 优先，缺失走链上（区分「非 ERC20」400 与「RPC 不可达」503）。 */
  private async resolveDecimals(
    chainId: number,
    address: string,
  ): Promise<number> {
    const token = await this.prisma.token.findUnique({
      where: { chain_id_address: { chain_id: chainId, address } },
    });
    if (token) {
      return token.decimals;
    }
    try {
      const meta = await this.erc20.readMetadata(chainId, address);
      return meta.decimals;
    } catch (err) {
      throw this.toTokenException(err, address);
    }
  }

  /** 区分 token 非法（400）与 RPC 不可达（503）。 */
  private toTokenException(err: unknown, address: string): HttpException {
    const msg = this.errMsg(err);
    if (/returned no data|not a contract|is not a contract/i.test(msg)) {
      return new BadRequestException(
        `token 不是有效的 ERC20 合约（chain 无法读取 name/symbol/decimals）: ${address}`,
      );
    }
    return this.toRpcException(err);
  }

  private async readBlockNumber(chainId: number): Promise<number> {
    try {
      const bn = await this.rpc.getClient(chainId).getBlockNumber();
      return Number(bn);
    } catch (err) {
      throw this.toRpcException(err);
    }
  }

  private toRpcException(err: unknown): HttpException {
    const message =
      err instanceof ChainReadError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return new HttpException(
      { code: ErrorCodes.RPC_UNAVAILABLE, message },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
