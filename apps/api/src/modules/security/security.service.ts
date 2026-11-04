import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { errorMessage } from '../../chain/chain.errors';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { getCatalogEntry } from '../../chain/token-catalog';
import {
  DataAuthenticity,
  type DataAuthenticity as DataAuthenticityType,
} from '../../common/constants/data-authenticity';
import type { TokenSecurityDto } from './security.types';

/**
 * Token Security 安全中心服务（MODULE 08）。
 * 综合三条信号给出 token 安全判定：
 * 1. hasContractCode —— 链上 getBytecode 是否非空（REAL_ONCHAIN）
 * 2. verified / risk / isInCatalog —— 官方 token-catalog 标记（INTERNAL_CALCULATED）
 * 3. 未命中 catalog 时回退 DB Token 表的 is_verified / risk
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: ChainRpcService,
  ) {}

  async getTokenSecurity(
    chainId: number | undefined,
    address: string,
  ): Promise<TokenSecurityDto> {
    const resolved = this.resolveChainId(chainId);
    const addr = this.assertAddress(address, 'token address');

    const catalog = getCatalogEntry(resolved, addr);

    let symbol: string | null = null;
    let name: string | null = null;
    let verified = false;
    let risk = false;
    let isInCatalog = false;

    if (catalog) {
      symbol = catalog.symbol;
      name = catalog.name;
      verified = catalog.verified;
      risk = catalog.risk;
      isInCatalog = true;
    } else {
      const db = await this.prisma.token.findUnique({
        where: { chain_id_address: { chain_id: resolved, address: addr } },
      });
      if (db) {
        symbol = db.symbol;
        name = db.name;
        verified = db.is_verified;
        risk = db.risk;
      }
    }

    const hasContractCode = await this.readContractCode(resolved, addr);

    return {
      chainId: resolved,
      address: addr,
      symbol,
      name,
      verified,
      risk,
      hasContractCode,
      isInCatalog,
      authenticity: this.resolveAuthenticity(
        hasContractCode,
        isInCatalog || symbol !== null,
      ),
    };
  }

  // ---------- 私有工具 ----------

  /** 读链上合约 code，非空表示合约存在；失败降级为 null（不抛 500）。 */
  private async readContractCode(
    chainId: number,
    address: string,
  ): Promise<boolean | null> {
    try {
      const client = this.rpc.getClient(chainId);
      const code = await client.getBytecode({
        address: address as `0x${string}`,
      });
      return code !== undefined && code !== null && code !== '0x';
    } catch (err) {
      this.logger.warn(
        `读取合约 code 失败（chain=${chainId} address=${address}）: ${errorMessage(err)}`,
      );
      return null;
    }
  }

  /**
   * 安全判定数据来源：
   * - 链上合约存在性读取成功 → REAL_ONCHAIN（最权威）
   * - 链上读取失败但有 catalog/DB 内部标记 → INTERNAL_CALCULATED
   * - 两者皆无 → UNAVAILABLE
   */
  private resolveAuthenticity(
    hasContractCode: boolean | null,
    hasInternalMark: boolean,
  ): DataAuthenticityType {
    if (hasContractCode !== null) {
      return DataAuthenticity.REAL_ONCHAIN;
    }
    if (hasInternalMark) {
      return DataAuthenticity.INTERNAL_CALCULATED;
    }
    return DataAuthenticity.UNAVAILABLE;
  }

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
}
