import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Erc20ReaderService,
  type Erc20Metadata,
} from '../../chain/erc20-reader.service';
import { ChainReadError } from '../../chain/chain.errors';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { getCatalogEntry } from '../../chain/token-catalog';
import { ErrorCodes } from '../../common/constants/error-codes';
import { formatUnits } from '../../common/utils/units';
import {
  toTokenDto,
  type TokenBalanceDto,
  type TokenDto,
  type TokenListResult,
} from './token.types';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erc20: Erc20ReaderService,
  ) {}

  /** 分页列出 Token，支持 chainId 过滤 */
  async getTokens(query: {
    chainId?: number;
    page?: number;
    limit?: number;
  }): Promise<TokenListResult> {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    this.assertChainIdIfPresent(query.chainId);

    const where = query.chainId !== undefined ? { chain_id: query.chainId } : {};
    const [total, rows] = await Promise.all([
      this.prisma.token.count({ where }),
      this.prisma.token.findMany({
        where,
        orderBy: [{ is_verified: 'desc' }, { symbol: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items: rows.map(toTokenDto), page, limit, total };
  }

  /** 按 symbol / name / address 模糊搜索（大小写不敏感） */
  async searchTokens(q: string, chainId?: number): Promise<TokenDto[]> {
    this.assertChainIdIfPresent(chainId);
    const rows = await this.prisma.token.findMany({
      where: {
        ...(chainId !== undefined ? { chain_id: chainId } : {}),
        OR: [
          { symbol: { contains: q } },
          { name: { contains: q } },
          { address: { contains: q } },
        ],
      },
      orderBy: [{ is_verified: 'desc' }, { symbol: 'asc' }],
      take: 50,
    });
    return rows.map(toTokenDto);
  }

  /** 列出已验证 Token */
  async getVerifiedTokens(chainId?: number): Promise<TokenDto[]> {
    this.assertChainIdIfPresent(chainId);
    const rows = await this.prisma.token.findMany({
      where: {
        is_verified: true,
        ...(chainId !== undefined ? { chain_id: chainId } : {}),
      },
      orderBy: { symbol: 'asc' },
    });
    return rows.map(toTokenDto);
  }

  /** 按 chain_id + address 查单个 Token */
  async getToken(chainId: number | undefined, address: string): Promise<TokenDto> {
    const resolvedChainId = this.resolveChainId(chainId);
    const addr = this.assertAddress(address, 'token address');
    const token = await this.prisma.token.findUnique({
      where: { chain_id_address: { chain_id: resolvedChainId, address: addr } },
    });
    if (!token) {
      throw new NotFoundException(
        `Token 不存在（chain=${resolvedChainId} address=${addr}）`,
      );
    }
    return toTokenDto(token);
  }

  /** 读钱包在指定 Token 的余额（走真实链上 balanceOf） */
  async getTokenBalance(
    chainId: number | undefined,
    address: string,
    wallet: string,
  ): Promise<TokenBalanceDto> {
    const resolvedChainId = this.resolveChainId(chainId);
    const addr = this.assertAddress(address, 'token address');
    const owner = this.assertAddress(wallet, 'wallet');

    // 优先从库取 decimals/symbol，减少 RPC 往返；库里没有则链上读元数据
    const token = await this.prisma.token.findUnique({
      where: { chain_id_address: { chain_id: resolvedChainId, address: addr } },
    });

    let symbol: string;
    let decimals: number;
    if (token) {
      symbol = token.symbol;
      decimals = token.decimals;
    } else {
      const meta = await this.readMetadataOrThrow(resolvedChainId, addr);
      symbol = meta.symbol;
      decimals = meta.decimals;
    }

    const rawBigInt = await this.readBalanceOrThrow(
      resolvedChainId,
      addr,
      owner,
    );
    const raw = rawBigInt.toString();

    return {
      chainId: resolvedChainId,
      address: addr,
      wallet: owner,
      symbol,
      decimals,
      raw,
      formatted: formatUnits(raw, decimals),
    };
  }

  /** 链上读取元数据后入库（地址规范化小写、chain_id 区分；白名单/风险标记） */
  async upsertToken(chainId: number | undefined, address: string): Promise<TokenDto> {
    const resolvedChainId = this.resolveChainId(chainId);
    const addr = this.assertAddress(address, 'token address');

    const meta = await this.readMetadataOrThrow(resolvedChainId, addr);
    const catalog = getCatalogEntry(resolvedChainId, addr);

    const data = {
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      is_verified: catalog?.verified ?? false,
      risk: catalog?.risk ?? false,
      logo_uri: catalog?.logoURI ?? null,
      source: 'onchain',
    };

    const token = await this.prisma.token.upsert({
      where: { chain_id_address: { chain_id: resolvedChainId, address: addr } },
      update: data,
      create: { chain_id: resolvedChainId, address: addr, ...data },
    });

    return toTokenDto(token);
  }

  // ---------- 私有工具 ----------

  private resolveChainId(chainId?: number): number {
    if (chainId === undefined) {
      return BASE_MAINNET_CHAIN_ID;
    }
    this.assertChainId(chainId);
    return chainId;
  }

  private assertChainIdIfPresent(chainId?: number): void {
    if (chainId !== undefined) {
      this.assertChainId(chainId);
    }
  }

  private assertChainId(chainId: number): void {
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
  }

  private assertAddress(address: string, label: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`${label} 不是合法的 EVM 地址: ${address}`);
    }
    return normalizeAddress(address);
  }

  private normalizePage(page?: number): number {
    const p = page ?? DEFAULT_PAGE;
    if (!Number.isInteger(p) || p < 1) {
      throw new BadRequestException('page 必须是 >= 1 的整数');
    }
    return p;
  }

  private normalizeLimit(limit?: number): number {
    const l = limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(l) || l < 1) {
      throw new BadRequestException('limit 必须是 >= 1 的整数');
    }
    return Math.min(l, MAX_LIMIT);
  }

  private async readMetadataOrThrow(
    chainId: number,
    address: string,
  ): Promise<Erc20Metadata> {
    try {
      return await this.erc20.readMetadata(chainId, address);
    } catch (err) {
      throw this.toRpcException(err);
    }
  }

  private async readBalanceOrThrow(
    chainId: number,
    address: string,
    wallet: string,
  ): Promise<bigint> {
    try {
      return await this.erc20.readBalance(chainId, address, wallet);
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
