import { Injectable, Logger } from '@nestjs/common';
import { normalizeAddress } from '../../chain/address';

/**
 * CoinGecko 免费价格 Provider（第三方兜底）。
 *
 * 仅用于「链上无池 / RPC 不可达」时的价格兜底。CoinGecko 免费接口当前无需
 * API key，支持按逗号分隔批量查询 Base 链 token 的 USD 价格。
 *
 * 铁律：CoinGecko 返回的是 float number，本服务统一转换为「十进制字符串」输出，
 * 绝不向下游泄漏 Float；对极小价格（如 1e-7）展开科学计数法，避免污染 BigInt
 * 定点运算链路。请求失败 / 超时一律静默降级（返回空结果），绝不抛错。
 */
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/token_price/base';
/**
 * 每批地址数。
 * 注意：CoinGecko 免费档对 simple/token_price 接口当前限制「每次请求仅 1 个合约地址」
 * （超过返回 error_code=10012）。故这里固定为 1，逐个查询；免费档还有较严的
 * 速率限制（连续请求会静默返回空），因此本服务仅用于低频的单币兜底查询，
 * 不用于批量全量同步（批量场景应走付费档或其它 provider）。
 */
const BATCH_SIZE = 1;
/** 请求超时（毫秒）。 */
const TIMEOUT_MS = 10_000;
/** 进程内缓存 TTL（毫秒）。 */
const CACHE_TTL_MS = 30_000;

/** float → 十进制字符串；展开科学计数法（如 1e-7 → 0.0000001），非有限值返回 null。 */
function numberToDecimalString(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value === 0) {
    return '0';
  }
  const raw = String(value);
  // 大多数情况 String(number) 已是十进制（如 "0.5"、"1234.56"、"0.000001"）。
  if (!/[eE]/.test(raw)) {
    return raw;
  }
  // 科学计数法（JS 对 |v| < 1e-6 或 |v| >= 1e21 会用指数表示），拆解为：
  // (-?)(int)(.frac)?(e)(+-exp)  →  整数位 + 小数位 + 10 的指数。
  const m = raw.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) {
    return raw; // 极端兜底：原样返回
  }
  const sign = m[1];
  const digits = m[2] + (m[3] ?? '');
  const pointPos = m[2].length + Number(m[4]); // 小数点应落在第 pointPos 位数字之后
  let out: string;
  if (pointPos <= 0) {
    out = `0.${'0'.repeat(-pointPos)}${digits}`;
  } else if (pointPos >= digits.length) {
    out = digits + '0'.repeat(pointPos - digits.length);
  } else {
    out = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  }
  return sign + out;
}

@Injectable()
export class PriceProviderService {
  private readonly logger = new Logger(PriceProviderService.name);
  private readonly cache = new Map<
    string,
    { price: string; expiresAt: number }
  >();

  /** 单个地址查询 USD 价格；未收录 / 失败返回 null（绝不抛错）。 */
  async getUsdPrice(address: string): Promise<string | null> {
    const prices = await this.getUsdPrices([address]);
    return prices.get(normalizeAddress(address)) ?? null;
  }

  /** 批量查询，返回「小写地址 → 十进制字符串价格」映射；失败静默返回已成功部分。 */
  async getUsdPrices(addresses: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const now = Date.now();
    const toFetch: string[] = [];

    for (const raw of addresses) {
      const addr = normalizeAddress(raw);
      if (!addr) {
        continue;
      }
      const cached = this.cache.get(addr);
      if (cached && cached.expiresAt > now) {
        result.set(addr, cached.price);
      } else if (!toFetch.includes(addr)) {
        toFetch.push(addr);
      }
    }

    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      const fetched = await this.fetchBatch(batch);
      for (const [addr, price] of fetched) {
        this.cache.set(addr, { price, expiresAt: Date.now() + CACHE_TTL_MS });
        result.set(addr, price);
      }
    }

    return result;
  }

  /** 单批请求（≤30 地址），异常 / 非 2xx 返回空 Map，绝不抛错。 */
  private async fetchBatch(addresses: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const url = `${COINGECKO_URL}?contract_addresses=${encodeURIComponent(
      addresses.join(','),
    )}&vs_currencies=usd`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `CoinGecko 查询失败（HTTP ${res.status}），已降级跳过 ${addresses.length} 个地址`,
        );
        return out;
      }
      const json: unknown = await res.json();
      if (json == null || typeof json !== 'object') {
        return out;
      }
      // CoinGecko 返回 { "<原样大小写地址>": { "usd": <number> } }。
      for (const [rawAddr, entry] of Object.entries(json)) {
        const price = numberToDecimalString(
          (entry as { usd?: unknown } | undefined)?.usd,
        );
        if (price === null) {
          continue;
        }
        out.set(normalizeAddress(rawAddr), price);
      }
    } catch (err) {
      this.logger.warn(
        `CoinGecko 查询异常（${this.errMsg(err)}），已降级跳过`,
      );
    }
    return out;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
