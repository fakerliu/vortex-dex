import { BadRequestException, Injectable } from '@nestjs/common';
import type { UserPreference } from '@prisma/client';
import { normalizeAddress } from '../../chain/address';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FavoriteTokenDto,
  UpdatePreferenceRequestDto,
  UserPreferenceDto,
} from './preferences.types';

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_CHAIN_ID = 8453;
const DEFAULT_DEADLINE_SEC = 1200;

/** default_chain_id 合法取值（Base 主网 / Sepolia）。 */
const ALLOWED_CHAIN_IDS = new Set<number>([8453, 84532]);

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 读取偏好；无记录返回全默认值（不落库，幂等）。
   */
  async getPreference(userAddress: string): Promise<UserPreferenceDto> {
    const addr = normalizeAddress(userAddress);
    const row = await this.prisma.userPreference.findUnique({
      where: { user_address: addr },
    });
    return this.toPreferenceDto(row, addr);
  }

  /**
   * upsert 偏好：有记录则更新传入字段，无则创建（缺省字段用默认值）。
   * 校验 defaultSlippageBps / defaultChainId / defaultDeadlineSec，非法抛 BadRequestException。
   */
  async updatePreference(
    userAddress: string,
    req: UpdatePreferenceRequestDto,
  ): Promise<UserPreferenceDto> {
    const addr = normalizeAddress(userAddress);
    this.validate(req);

    const data: Record<string, number | boolean> = {};
    if (req.defaultSlippageBps !== undefined) {
      data.default_slippage_bps = req.defaultSlippageBps;
    }
    if (req.defaultChainId !== undefined) {
      data.default_chain_id = req.defaultChainId;
    }
    if (req.defaultDeadlineSec !== undefined) {
      data.default_deadline_sec = req.defaultDeadlineSec;
    }
    if (req.notifyAlerts !== undefined) {
      data.notify_alerts = req.notifyAlerts;
    }

    // 空 body：无任何字段需要更新，直接走读路径（避免 Prisma 空 update）。
    if (Object.keys(data).length === 0) {
      return this.getPreference(addr);
    }

    const row = await this.prisma.userPreference.upsert({
      where: { user_address: addr },
      create: { user_address: addr, ...data },
      update: data,
    });
    return this.toPreferenceDto(row, addr);
  }

  /**
   * 加收藏：读现有 favorite_tokens（JSON 字符串）→ 解析 → 按 address 去重 → 追加 → 写回。
   * 记录不存在时先建默认记录（favorite_tokens 仅含新增项）。
   */
  async addFavorite(
    userAddress: string,
    fav: FavoriteTokenDto,
  ): Promise<UserPreferenceDto> {
    const addr = normalizeAddress(userAddress);
    const existing = await this.prisma.userPreference.findUnique({
      where: { user_address: addr },
    });
    const tokens = this.parseFavoriteTokens(existing?.favorite_tokens);

    const item: FavoriteTokenDto = {
      chainId: fav.chainId,
      address: normalizeAddress(fav.address),
      symbol: fav.symbol,
    };
    const next = tokens.filter((t) => t.address !== item.address);
    next.push(item);

    const serialized = JSON.stringify(next);
    const row = await this.prisma.userPreference.upsert({
      where: { user_address: addr },
      create: { user_address: addr, favorite_tokens: serialized },
      update: { favorite_tokens: serialized },
    });
    return this.toPreferenceDto(row, addr);
  }

  /**
   * 移除收藏：解析数组 → 按 address 过滤掉 → 写回。
   */
  async removeFavorite(
    userAddress: string,
    tokenAddress: string,
  ): Promise<UserPreferenceDto> {
    const addr = normalizeAddress(userAddress);
    const target = normalizeAddress(tokenAddress);
    const existing = await this.prisma.userPreference.findUnique({
      where: { user_address: addr },
    });
    const tokens = this.parseFavoriteTokens(existing?.favorite_tokens);

    const next = tokens.filter((t) => t.address !== target);
    const serialized = JSON.stringify(next);
    const row = await this.prisma.userPreference.upsert({
      where: { user_address: addr },
      create: { user_address: addr, favorite_tokens: serialized },
      update: { favorite_tokens: serialized },
    });
    return this.toPreferenceDto(row, addr);
  }

  // ---------- 私有方法 ----------

  private validate(req: UpdatePreferenceRequestDto): void {
    if (req.defaultSlippageBps !== undefined) {
      if (
        !Number.isInteger(req.defaultSlippageBps) ||
        req.defaultSlippageBps < 0 ||
        req.defaultSlippageBps > 10000
      ) {
        throw new BadRequestException(
          'defaultSlippageBps 必须是 0~10000 的整数',
        );
      }
    }
    if (req.defaultChainId !== undefined) {
      if (!ALLOWED_CHAIN_IDS.has(req.defaultChainId)) {
        throw new BadRequestException('defaultChainId 仅支持 8453 / 84532');
      }
    }
    if (req.defaultDeadlineSec !== undefined) {
      if (!Number.isInteger(req.defaultDeadlineSec) || req.defaultDeadlineSec <= 0) {
        throw new BadRequestException('defaultDeadlineSec 必须是大于 0 的整数');
      }
    }
  }

  /**
   * 解析 favorite_tokens JSON 字符串为数组；null / 非法 JSON / 非数组 → []。
   */
  private parseFavoriteTokens(
    raw: string | null | undefined,
  ): FavoriteTokenDto[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(
          (t): t is Record<string, unknown> =>
            typeof t === 'object' && t !== null,
        )
        .map((t) => ({
          chainId: typeof t.chainId === 'number' ? t.chainId : 0,
          address:
            typeof t.address === 'string'
              ? normalizeAddress(t.address)
              : '',
          symbol: typeof t.symbol === 'string' ? t.symbol : '',
        }));
    } catch {
      return [];
    }
  }

  /**
   * 把 Prisma 行转 UserPreferenceDto；row 为 null 时用 fallbackAddress 返回全默认值。
   */
  private toPreferenceDto(
    row: UserPreference | null,
    fallbackAddress: string,
  ): UserPreferenceDto {
    if (!row) {
      return {
        userAddress: fallbackAddress,
        defaultSlippageBps: DEFAULT_SLIPPAGE_BPS,
        defaultChainId: DEFAULT_CHAIN_ID,
        defaultDeadlineSec: DEFAULT_DEADLINE_SEC,
        notifyAlerts: true,
        favoriteTokens: [],
      };
    }
    return {
      userAddress: row.user_address,
      defaultSlippageBps: row.default_slippage_bps,
      defaultChainId: row.default_chain_id,
      defaultDeadlineSec: row.default_deadline_sec,
      notifyAlerts: row.notify_alerts,
      favoriteTokens: this.parseFavoriteTokens(row.favorite_tokens),
    };
  }
}
