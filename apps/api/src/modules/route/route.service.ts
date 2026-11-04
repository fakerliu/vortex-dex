import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { ChainReadError } from '../../chain/chain.errors';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DexPoolService, type PoolQuoteCandidate } from '../../dex/dex-pool.service';
import {
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
} from '../../dex/aerodrome/constants';
import {
  combinePriceImpacts,
  formatFraction,
  parseAmount,
} from '../../dex/math';
import type { PoolKind } from '../../dex/types';
import type {
  RouteCandidateDto,
  RouteHopDto,
  RouteRequestDto,
  RouteResponseDto,
} from './route.types';
import { toRouteCandidateDto } from './route.types';
import { EventCollectorService } from '../analytics/event-collector.service';

/** Base Mainnet 已核对 hub token（多跳中间跳候选）。 */
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const DEFAULT_HUB_TOKENS = [WETH, USDC];

const DEFAULT_MAX_PATH_LENGTH = 2;
const MAX_PATH_LENGTH = 3;

/** Gas 换算成输出 token 的参考金额（1 WETH）。 */
const GAS_CONVERSION_REFERENCE = 10n ** 18n;

/** 内部路由候选（计算中，BigInt 原始单位）。 */
interface RoutePath {
  tokenPath: string[];
  poolPath: string[];
  protocolPath: string[];
  amountIn: string;
  amountOut: bigint;
  estimatedGas: bigint;
  priceImpact: string;
  hops: RouteHop[];
  gasCostInOutputToken: bigint;
  gasConverted: boolean;
  netOutput: bigint;
  routeScore: string;
}

interface RouteHop {
  pool: string;
  kind: PoolKind;
  protocolType: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: bigint;
  fee: string;
  priceImpact: string;
  source: string;
  gasEstimate: bigint;
}

interface EthToTokenRate {
  rateNum: bigint;
  rateDen: bigint;
  path: string[];
  method: string;
  uncertain: boolean;
}

/**
 * 路由引擎（Sprint 5）：多跳路径搜索 + Gas 调整后的净输出比较。
 *
 * - 以 tokenIn 为起点，遍历「直接 + 经 hub（WETH/USDC）的多跳」路径。
 * - 每条路径逐跳报价（复用 DexPoolService），聚合 amountOut/gas/priceImpact。
 * - NetOutput = AmountOut - GasCostInOutputToken（gas 换算成输出 token 后相减）。
 * - 拆单路由本轮不做（P1）。
 */
@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: ChainRpcService,
    private readonly poolService: DexPoolService,
    private readonly events: EventCollectorService,
  ) {}

  async computeRoute(req: RouteRequestDto): Promise<RouteResponseDto> {
    const startedAt = Date.now();
    const chainId = this.resolveChainId(req.chainId);
    const tokenIn = this.assertAddress(req.tokenIn, 'tokenIn');
    const tokenOut = this.assertAddress(req.tokenOut, 'tokenOut');
    if (tokenIn === tokenOut) {
      throw new BadRequestException('tokenIn 与 tokenOut 不能相同');
    }
    if (!/^\d+$/.test(req.amountIn.trim())) {
      throw new BadRequestException('amountIn 必须为正整数字符串（链上原始单位）');
    }
    const amountIn = parseAmount(req.amountIn);
    if (amountIn <= 0n) {
      throw new BadRequestException('amountIn 必须为正整数（链上原始单位）');
    }
    const maxPathLength = this.normalizeMaxPathLength(req.maxPathLength);
    const useClassic = this.protocolAllowed(req.protocols, AERODROME_PROTOCOL_TYPE_CLASSIC);
    const useCl = this.protocolAllowed(req.protocols, AERODROME_PROTOCOL_TYPE_CL);
    const hubs = this.resolveHubs(req.hubTokens, tokenIn, tokenOut);

    // 1. gas price（单次读取）
    const gasPrice = await this.readGasPrice(chainId);

    // 2. 构建候选路径（直接 + 多跳）
    const candidates: RoutePath[] = [];
    try {
      candidates.push(
        ...(await this.buildDirectCandidates(
          chainId, tokenIn, tokenOut, req.amountIn, useClassic, useCl,
        )),
      );

      if (maxPathLength >= 2) {
        for (const hub of hubs) {
          const p = await this.buildTwoHop(
            chainId, tokenIn, hub, tokenOut, req.amountIn, useClassic, useCl,
          );
          if (p) {
            candidates.push(p);
          }
        }
      }

      if (maxPathLength >= 3) {
        for (const h1 of hubs) {
          for (const h2 of hubs) {
            if (h1 === h2) {
              continue;
            }
            const p = await this.buildThreeHop(
              chainId, tokenIn, h1, h2, tokenOut, req.amountIn, useClassic, useCl,
            );
            if (p) {
              candidates.push(p);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw this.toRpcException(err);
    }

    if (candidates.length === 0) {
      throw new HttpException(
        {
          code: ErrorCodes.NO_ROUTE,
          message: `未找到可用路径（${tokenIn} -> ${tokenOut}，chain=${chainId}）`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // 3. gas -> 输出 token 换算率（仅依赖 tokenOut，计算一次）
    const ethToToken = await this.computeEthToTokenRate(chainId, tokenOut, useClassic, useCl);

    // 4. 计算 netOutput / routeScore
    for (const c of candidates) {
      const gasCostEthWei = c.estimatedGas * gasPrice;
      const gasCostInOutput =
        ethToToken.rateNum > 0n
          ? (gasCostEthWei * ethToToken.rateNum) / ethToToken.rateDen
          : 0n;
      c.gasConverted = ethToToken.rateNum > 0n;
      c.gasCostInOutputToken = c.gasConverted ? gasCostInOutput : 0n;
      c.netOutput = c.gasConverted ? c.amountOut - gasCostInOutput : c.amountOut;
      if (c.netOutput < 0n) {
        c.netOutput = 0n;
      }
      c.routeScore =
        c.amountOut > 0n ? formatFraction(c.netOutput, c.amountOut, 18) : '0';
    }

    // 5. 排序：netOutput 降序，其次 amountOut 降序
    candidates.sort((a, b) => {
      if (a.netOutput !== b.netOutput) {
        return a.netOutput > b.netOutput ? -1 : 1;
      }
      return a.amountOut > b.amountOut ? -1 : 1;
    });

    // 6. 入库 route_candidates（共享 path_id）
    const pathId = randomUUID();
    const blockNumber = await this.readBlockNumber(chainId);
    const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
    const routeComputeMs = Date.now() - startedAt;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      await this.prisma.routeCandidate.create({
        data: {
          path_id: pathId,
          token_path: JSON.stringify(c.tokenPath),
          pool_path: JSON.stringify(c.poolPath),
          protocol_path: JSON.stringify(c.protocolPath),
          amount_in: d(c.amountIn),
          amount_out: d(c.amountOut.toString()),
          estimated_gas: d(c.estimatedGas.toString()),
          net_output: d(c.netOutput.toString()),
          price_impact: d(c.priceImpact || '0'),
          route_score: d(c.routeScore || '0'),
          // Analytics：意图关联 + 耗时 + 选中标记（排序后第一个为最佳）
          ...(req.intentId ? { intent_id: req.intentId } : {}),
          is_selected: i === 0,
          route_compute_ms: routeComputeMs,
        },
      });
    }

    // Analytics 旁路：记录路由事件（失败不阻断）
    await this.events.track({
      eventName: 'route_engine_completed',
      chainId,
      walletAddress: req.userAddress,
      intentId: req.intentId,
      properties: {
        pathId,
        tokenIn,
        tokenOut,
        amountIn: req.amountIn,
        candidateCount: candidates.length,
        selectedProtocolPath: candidates[0].protocolPath,
        routeComputeMs,
      },
    });
    await this.events.recordMetric({
      serviceName: 'route-engine',
      metricName: 'candidate_count',
      metricValue: String(candidates.length),
      metricUnit: 'count',
      dimensions: { chainId, tokenIn, tokenOut },
    });
    await this.events.recordMetric({
      serviceName: 'route-engine',
      metricName: 'compute_ms',
      metricValue: String(routeComputeMs),
      metricUnit: 'ms',
      dimensions: { chainId },
    });

    return this.buildResponse(pathId, chainId, tokenIn, tokenOut, req.amountIn, {
      blockNumber,
      gasPriceWei: gasPrice.toString(),
      gasPriceSource: 'eth_gasPrice',
      gasConversionMethod: this.describeGasConversion(ethToToken),
      candidates: candidates.map((c) => this.toDto(c)),
    });
  }

  async getRoute(pathId: string): Promise<RouteResponseDto> {
    const rows = await this.prisma.routeCandidate.findMany({
      where: { path_id: pathId },
      orderBy: { net_output: 'desc' },
    });
    if (rows.length === 0) {
      throw new NotFoundException(`路由不存在（pathId=${pathId}）`);
    }
    const candidates = rows.map(toRouteCandidateDto);
    const first = candidates[0];
    const tokenIn = first.tokenPath[0] ?? '';
    const tokenOut = first.tokenPath[first.tokenPath.length - 1] ?? '';

    return this.buildResponse(pathId, BASE_MAINNET_CHAIN_ID, tokenIn, tokenOut, first.amountIn, {
      blockNumber: null,
      gasPriceWei: null,
      gasPriceSource: null,
      gasConversionMethod:
        'GET 不返回 gas 元信息；netOutput 已在写入时完成 gas 调整（gasCostInOutputToken = amountOut - netOutput）',
      candidates,
    });
  }

  // ---------- 路径构建 ----------

  private async buildDirectCandidates(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    useClassic: boolean,
    useCl: boolean,
  ): Promise<RoutePath[]> {
    const { classicPools, clPools } = await this.poolService.discoverPools(
      tokenIn,
      tokenOut,
      useClassic,
      useCl,
    );
    if (classicPools.length === 0 && clPools.length === 0) {
      return [];
    }
    const poolCandidates = await this.poolService.quotePair(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      classicPools,
      clPools,
    );
    return poolCandidates.map((pc) =>
      this.toPath([this.toHop(pc, tokenIn, tokenOut, amountIn)], amountIn),
    );
  }

  private async buildTwoHop(
    chainId: number,
    tokenIn: string,
    hub: string,
    tokenOut: string,
    amountIn: string,
    useClassic: boolean,
    useCl: boolean,
  ): Promise<RoutePath | null> {
    const hop1 = await this.poolService.quoteBest(chainId, tokenIn, hub, amountIn, useClassic, useCl);
    if (!hop1) {
      return null;
    }
    const amountIn2 = hop1.quote.amountOut;
    const hop2 = await this.poolService.quoteBest(chainId, hub, tokenOut, amountIn2, useClassic, useCl);
    if (!hop2) {
      return null;
    }
    const h1 = this.toHop(hop1, tokenIn, hub, amountIn);
    const h2 = this.toHop(hop2, hub, tokenOut, amountIn2);
    return this.toPath([h1, h2], amountIn);
  }

  private async buildThreeHop(
    chainId: number,
    tokenIn: string,
    h1Token: string,
    h2Token: string,
    tokenOut: string,
    amountIn: string,
    useClassic: boolean,
    useCl: boolean,
  ): Promise<RoutePath | null> {
    const hop1 = await this.poolService.quoteBest(chainId, tokenIn, h1Token, amountIn, useClassic, useCl);
    if (!hop1) {
      return null;
    }
    const amountIn2 = hop1.quote.amountOut;
    const hop2 = await this.poolService.quoteBest(chainId, h1Token, h2Token, amountIn2, useClassic, useCl);
    if (!hop2) {
      return null;
    }
    const amountIn3 = hop2.quote.amountOut;
    const hop3 = await this.poolService.quoteBest(chainId, h2Token, tokenOut, amountIn3, useClassic, useCl);
    if (!hop3) {
      return null;
    }
    const h1 = this.toHop(hop1, tokenIn, h1Token, amountIn);
    const h2 = this.toHop(hop2, h1Token, h2Token, amountIn2);
    const h3 = this.toHop(hop3, h2Token, tokenOut, amountIn3);
    return this.toPath([h1, h2, h3], amountIn);
  }

  private toHop(
    pc: PoolQuoteCandidate,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
  ): RouteHop {
    return {
      pool: pc.pool.address,
      kind: pc.quote.kind,
      protocolType: pc.protocolType,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: BigInt(pc.quote.amountOut),
      fee: pc.quote.fee,
      priceImpact: pc.quote.priceImpact,
      source: pc.quote.source,
      gasEstimate: BigInt(pc.quote.gasEstimate ?? pc.gas.gasLimit),
    };
  }

  private toPath(hops: RouteHop[], amountIn: string): RoutePath {
    const last = hops[hops.length - 1];
    return {
      tokenPath: [hops[0].tokenIn, ...hops.map((h) => h.tokenOut)],
      poolPath: hops.map((h) => h.pool),
      protocolPath: hops.map((h) => h.protocolType),
      amountIn,
      amountOut: last.amountOut,
      estimatedGas: hops.reduce((sum, h) => sum + h.gasEstimate, 0n),
      priceImpact: combinePriceImpacts(hops.map((h) => h.priceImpact)),
      hops,
      gasCostInOutputToken: 0n,
      gasConverted: false,
      netOutput: 0n,
      routeScore: '0',
    };
  }

  private toDto(c: RoutePath): RouteCandidateDto {
    return {
      tokenPath: c.tokenPath,
      poolPath: c.poolPath,
      protocolPath: c.protocolPath,
      amountIn: c.amountIn,
      amountOut: c.amountOut.toString(),
      estimatedGas: c.estimatedGas.toString(),
      gasCostInOutputToken: c.gasCostInOutputToken.toString(),
      netOutput: c.netOutput.toString(),
      priceImpact: c.priceImpact,
      routeScore: c.routeScore,
      gasConverted: c.gasConverted,
      hops: c.hops.map((h) => this.toHopDto(h)),
    };
  }

  private toHopDto(h: RouteHop): RouteHopDto {
    return {
      pool: h.pool,
      kind: h.kind,
      protocolType: h.protocolType,
      tokenIn: h.tokenIn,
      tokenOut: h.tokenOut,
      amountIn: h.amountIn,
      amountOut: h.amountOut.toString(),
      fee: h.fee,
      priceImpact: h.priceImpact,
      source: h.source,
      gasEstimate: h.gasEstimate.toString(),
    };
  }

  // ---------- Gas 换算 ----------

  private async computeEthToTokenRate(
    chainId: number,
    tokenOut: string,
    useClassic: boolean,
    useCl: boolean,
  ): Promise<EthToTokenRate> {
    if (tokenOut === WETH) {
      return {
        rateNum: 1n,
        rateDen: 1n,
        path: [WETH],
        method: 'tokenOut==WETH，与 ETH 1:1（18 decimals）',
        uncertain: false,
      };
    }

    // 直接 WETH -> tokenOut
    const direct = await this.poolService.quoteBest(
      chainId, WETH, tokenOut, GAS_CONVERSION_REFERENCE.toString(), useClassic, useCl,
    );
    if (direct) {
      return {
        rateNum: BigInt(direct.quote.amountOut),
        rateDen: GAS_CONVERSION_REFERENCE,
        path: [WETH, tokenOut],
        method: `WETH→tokenOut 单跳即期报价（参考 1 WETH，path=${[WETH, tokenOut].join('→')}）`,
        uncertain: false,
      };
    }

    // 两跳 WETH -> USDC -> tokenOut
    const hop1 = await this.poolService.quoteBest(
      chainId, WETH, USDC, GAS_CONVERSION_REFERENCE.toString(), useClassic, useCl,
    );
    if (hop1) {
      const hop2 = await this.poolService.quoteBest(
        chainId, USDC, tokenOut, hop1.quote.amountOut, useClassic, useCl,
      );
      if (hop2) {
        return {
          rateNum: BigInt(hop2.quote.amountOut),
          rateDen: GAS_CONVERSION_REFERENCE,
          path: [WETH, USDC, tokenOut],
          method: `WETH→USDC→tokenOut 两跳即期报价（参考 1 WETH，不确定性更高）`,
          uncertain: true,
        };
      }
    }

    return {
      rateNum: 0n,
      rateDen: 1n,
      path: [],
      method: '无法换算（无 WETH 到 tokenOut 的直接/两跳路径），netOutput 未扣 gas',
      uncertain: true,
    };
  }

  private describeGasConversion(rate: EthToTokenRate): string {
    const suffix = rate.uncertain ? '（标记为近似/不确定）' : '';
    return `${rate.method}${suffix}`;
  }

  // ---------- 校验与工具 ----------

  private resolveChainId(chainId?: number): number {
    if (chainId === undefined) {
      return BASE_MAINNET_CHAIN_ID;
    }
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(`不支持的 chainId: ${chainId}（支持 8453 / 84532）`);
    }
    return chainId;
  }

  private assertAddress(address: string, label: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`${label} 不是合法的 EVM 地址: ${address}`);
    }
    return normalizeAddress(address);
  }

  private normalizeMaxPathLength(maxPathLength?: number): number {
    const m = maxPathLength ?? DEFAULT_MAX_PATH_LENGTH;
    if (!Number.isInteger(m) || m < 1 || m > MAX_PATH_LENGTH) {
      throw new BadRequestException(
        `maxPathLength 必须是 1~${MAX_PATH_LENGTH} 的整数（跳数 = 池子数量）`,
      );
    }
    return m;
  }

  private resolveHubs(
    hubTokens: string[] | undefined,
    tokenIn: string,
    tokenOut: string,
  ): string[] {
    const list = hubTokens && hubTokens.length > 0 ? hubTokens : DEFAULT_HUB_TOKENS;
    const hubs = new Set<string>();
    for (const h of list) {
      if (!isValidAddress(h)) {
        throw new BadRequestException(`hubTokens 含非法地址: ${h}`);
      }
      const addr = normalizeAddress(h);
      if (addr !== tokenIn && addr !== tokenOut) {
        hubs.add(addr);
      }
    }
    return [...hubs];
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

  private buildResponse(
    pathId: string,
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    extra: {
      blockNumber: number | null;
      gasPriceWei: string | null;
      gasPriceSource: string | null;
      gasConversionMethod: string;
      candidates: RouteCandidateDto[];
    },
  ): RouteResponseDto {
    return {
      pathId,
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      blockNumber: extra.blockNumber,
      gasPriceWei: extra.gasPriceWei,
      gasPriceSource: extra.gasPriceSource,
      gasConversionMethod: extra.gasConversionMethod,
      candidates: extra.candidates,
      quoteTimestamp: new Date().toISOString(),
    };
  }

  private async readGasPrice(chainId: number): Promise<bigint> {
    try {
      return await this.rpc.getClient(chainId).getGasPrice();
    } catch (err) {
      throw this.toRpcException(err);
    }
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
}
