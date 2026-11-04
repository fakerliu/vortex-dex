import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { errorMessage } from '../../chain/chain.errors';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import {
  BASE_MAINNET_TOKENS,
  BASE_SEPOLIA_TOKENS,
  getCatalogEntry,
} from '../../chain/token-catalog';
import { AERODROME_SWAP_ROUTER } from '../../dex/aerodrome/constants';
import { DataAuthenticity } from '../../common/constants/data-authenticity';
import { formatUnits } from '../../common/utils/units';
import type { ApprovalDto, ApprovalListResult } from './approval.types';

/** 遍历所需的 token 最小元数据（symbol 未知时允许 null）。 */
interface TokenEntry {
  address: string; // 小写
  symbol: string | null;
  decimals: number;
}

/** 未知 token 精度兜底值（ERC-20 事实标准 18 位小数，仅极端降级场景使用）。 */
const FALLBACK_DECIMALS = 18;

/**
 * Approval 授权管理服务（MODULE 07）。
 * 读取某钱包对指定 token（或全部 token-catalog token）对默认 spender
 * （Aerodrome CL SwapRouter）的 ERC-20 allowance，全部走链上 allowanceOf。
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(private readonly erc20: Erc20ReaderService) {}

  async getApprovals(params: {
    wallet: string;
    chainId?: number;
    token?: string;
    spender?: string;
  }): Promise<ApprovalListResult> {
    const chainId = this.resolveChainId(params.chainId);
    const wallet = this.assertAddress(params.wallet, 'wallet');
    const spender =
      params.spender && params.spender.trim().length > 0
        ? this.assertAddress(params.spender.trim(), 'spender')
        : normalizeAddress(AERODROME_SWAP_ROUTER);

    const entries = await this.resolveEntries(chainId, params.token);

    const items: ApprovalDto[] = [];
    for (const entry of entries) {
      try {
        const allowance = await this.erc20.readAllowance(
          chainId,
          entry.address,
          wallet,
          spender,
        );
        const raw = allowance.toString();
        items.push({
          chainId,
          wallet,
          token: entry.address,
          symbol: entry.symbol,
          decimals: entry.decimals,
          spender,
          allowance: raw,
          allowanceFormatted: formatUnits(raw, entry.decimals),
          hasAllowance: allowance > 0n,
          authenticity: DataAuthenticity.REAL_ONCHAIN,
        });
      } catch (err) {
        // 单个 token 读取失败仅记录并跳过，不拖垮整个列表
        this.logger.warn(
          `跳过 token ${entry.address} 的 allowance 读取: ${errorMessage(err)}`,
        );
      }
    }

    return { wallet, chainId, spender, items };
  }

  // ---------- 私有工具 ----------

  /** 确定要查询的 token 列表（传 token 只查一个，否则遍历该链 catalog）。 */
  private async resolveEntries(
    chainId: number,
    token?: string,
  ): Promise<TokenEntry[]> {
    if (token && token.trim().length > 0) {
      const addr = this.assertAddress(token.trim(), 'token');
      const catalog = getCatalogEntry(chainId, addr);
      if (catalog) {
        return [{ address: addr, symbol: catalog.symbol, decimals: catalog.decimals }];
      }
      const meta = await this.resolveMetadata(chainId, addr);
      return [{ address: addr, symbol: meta.symbol, decimals: meta.decimals }];
    }

    const catalog =
      chainId === BASE_MAINNET_CHAIN_ID ? BASE_MAINNET_TOKENS : BASE_SEPOLIA_TOKENS;
    return catalog.map((t) => ({
      address: normalizeAddress(t.address),
      symbol: t.symbol,
      decimals: t.decimals,
    }));
  }

  /** 自定义 token 不在 catalog 时，链上读 symbol/decimals；失败降级。 */
  private async resolveMetadata(
    chainId: number,
    address: string,
  ): Promise<{ symbol: string | null; decimals: number }> {
    try {
      const meta = await this.erc20.readMetadata(chainId, address);
      return { symbol: meta.symbol, decimals: meta.decimals };
    } catch (err) {
      this.logger.warn(
        `读取 token ${address} 元数据失败，降级 decimals=${FALLBACK_DECIMALS}: ${errorMessage(err)}`,
      );
      return { symbol: null, decimals: FALLBACK_DECIMALS };
    }
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
