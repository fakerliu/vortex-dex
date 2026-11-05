import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DexPoolService } from '../../dex/dex-pool.service';
import { formatFraction, formatPrice, parseDecimal } from '../../dex/math';
import { formatUnits } from '../../common/utils/units';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import {
  BASE_MAINNET_TOKENS,
  BASE_SEPOLIA_TOKENS,
  getCatalogEntry,
  type TokenCatalogEntry,
} from '../../chain/token-catalog';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { DataAuthenticity } from '../../common/constants/data-authenticity';
import type {
  MarketPriceDto,
  MarketSnapshotDto,
  MarketSnapshotResult,
} from './market.types';

/**
 * 链上推导价格的基准 token 地址（已核对，禁止编造）。
 * - Base Mainnet USDC：0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 * - Base Sepolia USDC：0x036CbD53842c5426634e7929541eC2318f3dCF7e
 * - WETH：0x4200000000000000000000000000000000000006（两链同地址）
 */
const BASE_TOKEN_ADDRESSES: Record<number, { usdc: string; weth: string }> = {
  [BASE_MAINNET_CHAIN_ID]: {
    usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    weth: '0x4200000000000000000000000000000000000006',
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    weth: '0x4200000000000000000000000000000000000006',
  },
};

const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;

/** 价格推导用的参考量：1 个目标 token（chain 原始大整数）。 */
function referenceAmount(decimals: number): string {
  return (10n ** BigInt(decimals)).toString();
}

/**
 * 定点小数乘法（纯 BigInt，18 位精度，输出十进制字符串去尾零）。
 * 用于 token→WETH→USDC 两跳价格合成。
 */
function mulDecimal(a: string, b: string): string {
  const scale = 18n;
  const x = parseDecimal(a, scale); // a × 10^18
  const y = parseDecimal(b, scale); // b × 10^18
  // x*y = a·b × 10^36，除以 10^18 回到 18 位定点，再 formatUnits 输出十进制字符串
  return formatUnits(((x * y) / (10n ** scale)).toString(), 18);
}

/**
 * Market Data Provider（Sprint 2）。
 *
 * 价格来源为「链上推导」而非第三方 API：复用 DexPoolService 对目标 token 做
 * 即期报价（token→USDC 直接对，无池则 token→WETH→USDC 两跳），由链上池子
 * 储备量推导出 USD 价格。所有价格用 BigInt + 字符串运算，绝不使用 Float。
 *
 * 优雅降级：链上无池 / RPC 不可达时返回 authenticity=UNAVAILABLE（priceUsd=null），
 * 不抛 500 —— 市场数据部分失败不应拖垮整个接口。
 */
@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dex: DexPoolService,
    private readonly rpc: ChainRpcService,
  ) {}

  /** 单 token 价格（token→USDC 或 token→WETH→USDC 链上推导）。 */
  async getTokenPrice(
    chainId: number | undefined,
    tokenAddress: string,
  ): Promise<MarketPriceDto> {
    const resolvedChainId = this.resolveChainId(chainId);
    const addr = this.assertAddress(tokenAddress);
    const { usdc, weth } = BASE_TOKEN_ADDRESSES[resolvedChainId];

    const decimals = await this.resolveDecimals(resolvedChainId, addr);

    // USDC 是基准 token，价格恒为 1（真实链上语义：1 USDC = 1 USD）。
    if (addr === usdc) {
      return {
        chainId: resolvedChainId,
        tokenAddress: addr,
        priceUsd: '1',
        quoteToken: usdc,
        authenticity: DataAuthenticity.REAL_ONCHAIN,
        source: 'base-token-usdc',
        blockNumber: await this.getCurrentBlock(resolvedChainId),
      };
    }

    const amountIn = referenceAmount(decimals);

    // 1) 直接 token→USDC
    const direct = await this.safeQuote(resolvedChainId, addr, usdc, amountIn);
    if (direct) {
      const priceUsd = formatPrice(
        BigInt(amountIn),
        decimals,
        direct.amountOut,
        USDC_DECIMALS,
      );
      return {
        chainId: resolvedChainId,
        tokenAddress: addr,
        priceUsd,
        quoteToken: usdc,
        authenticity: DataAuthenticity.REAL_ONCHAIN,
        source: 'onchain-quote-via-usdc',
        blockNumber: await this.getCurrentBlock(resolvedChainId),
      };
    }

    // 2) 两跳：token→WETH 再 WETH→USDC
    const t2w = await this.safeQuote(resolvedChainId, addr, weth, amountIn);
    if (t2w) {
      const w2u = await this.safeQuote(
        resolvedChainId,
        weth,
        usdc,
        referenceAmount(WETH_DECIMALS),
      );
      if (w2u) {
        const wethPrice = formatPrice(
          10n ** BigInt(WETH_DECIMALS),
          WETH_DECIMALS,
          w2u.amountOut,
          USDC_DECIMALS,
        );
        const tokenWethValue = formatFraction(
          t2w.amountOut,
          10n ** BigInt(WETH_DECIMALS),
          18,
        );
        const priceUsd = mulDecimal(tokenWethValue, wethPrice);
        return {
          chainId: resolvedChainId,
          tokenAddress: addr,
          priceUsd,
          quoteToken: weth,
          authenticity: DataAuthenticity.REAL_ONCHAIN,
          source: 'onchain-quote-via-weth',
          blockNumber: await this.getCurrentBlock(resolvedChainId),
        };
      }
    }

    // 链上无池 / 报价失败 → 优雅降级
    this.logger.warn(
      `Market 价格不可用（chain=${resolvedChainId} token=${addr}），无可用链上池`,
    );
    return {
      chainId: resolvedChainId,
      tokenAddress: addr,
      priceUsd: null,
      quoteToken: null,
      authenticity: DataAuthenticity.UNAVAILABLE,
      source: null,
      blockNumber: null,
    };
  }

  /** 批量报价目录内已验证 token，返回快照列表并落库（每 token 一条最新快照）。 */
  async getMarketSnapshot(
    chainId: number | undefined,
  ): Promise<MarketSnapshotResult> {
    const resolvedChainId = this.resolveChainId(chainId);
    const tokens = this.catalogTokensForChain(resolvedChainId).filter(
      (t) => t.verified,
    );
    const blockNumber = await this.getCurrentBlock(resolvedChainId);

    const items: MarketSnapshotDto[] = [];
    for (const token of tokens) {
      const price = await this.getTokenPrice(resolvedChainId, token.address);
      const dto: MarketSnapshotDto = {
        ...price,
        symbol: token.symbol,
        decimals: token.decimals,
        liquidityUsd: null,
        updatedAt: new Date().toISOString(),
      };
      items.push(dto);
      await this.persistSnapshot(resolvedChainId, token, price);
    }

    return { chainId: resolvedChainId, blockNumber, items };
  }

  // ---------- 私有工具 ----------

  /** 逐跳报价，RPC 整体失败 / 无候选返回 null（不抛 500）。 */
  private async safeQuote(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
  ): Promise<{ amountOut: bigint } | null> {
    try {
      const candidate = await this.dex.quoteBestForChain(
        chainId,
        tokenIn,
        tokenOut,
        amountIn,
      );
      if (!candidate) {
        return null;
      }
      const amountOut = BigInt(candidate.quote.amountOut);
      if (amountOut <= 0n) {
        return null;
      }
      return { amountOut };
    } catch (err) {
      this.logger.warn(
        `Market 报价失败（${tokenIn}→${tokenOut}）: ${this.errMsg(err)}`,
      );
      return null;
    }
  }

  /** 读取当前区块高度；RPC 不可达返回 null（不阻断主流程）。 */
  private async getCurrentBlock(chainId: number): Promise<number | null> {
    try {
      const block = await this.rpc.getClient(chainId).getBlockNumber();
      return Number(block);
    } catch {
      return null;
    }
  }

  /** 解析 token decimals：优先目录，其次数据库 Token 表，兜底 18。 */
  private async resolveDecimals(
    chainId: number,
    address: string,
  ): Promise<number> {
    const entry = getCatalogEntry(chainId, address);
    if (entry) {
      return entry.decimals;
    }
    try {
      const row = await this.prisma.token.findUnique({
        where: { chain_id_address: { chain_id: chainId, address } },
        select: { decimals: true },
      });
      if (row) {
        return row.decimals;
      }
    } catch {
      // 数据库不可达不影响价格推导（仅 decimals 精度兜底）
    }
    return 18;
  }

  /** 追加一条历史快照（create）；失败仅告警，不影响返回。 */
  private async persistSnapshot(
    chainId: number,
    token: TokenCatalogEntry,
    price: MarketPriceDto,
  ): Promise<void> {
    try {
      const tokenAddress = normalizeAddress(token.address);
      await this.prisma.marketSnapshot.create({
        data: {
          chain_id: chainId,
          token_address: tokenAddress,
          price_usd: price.priceUsd,
          quote_token: price.quoteToken,
          liquidity_usd: null,
          authenticity: price.authenticity,
          source: price.source,
          block_number: price.blockNumber,
        },
      });
    } catch (err) {
      this.logger.warn(
        `MarketSnapshot 落库失败 ${token.symbol}: ${this.errMsg(err)}`,
      );
    }
  }

  private catalogTokensForChain(chainId: number): TokenCatalogEntry[] {
    return chainId === BASE_SEPOLIA_CHAIN_ID
      ? BASE_SEPOLIA_TOKENS
      : BASE_MAINNET_TOKENS;
  }

  private resolveChainId(chainId?: number): number {
    const resolved = chainId ?? BASE_MAINNET_CHAIN_ID;
    if (!isSupportedChainId(resolved)) {
      throw new BadRequestException(
        `不支持的 chainId: ${resolved}（支持 8453 / 84532）`,
      );
    }
    return resolved;
  }

  private assertAddress(address: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`token 不是合法的 EVM 地址: ${address}`);
    }
    return normalizeAddress(address);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
