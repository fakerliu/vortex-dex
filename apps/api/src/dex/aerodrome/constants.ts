/**
 * Aerodrome（Base Mainnet）合约地址与协议元信息。
 *
 * 来源与核验（2026-11，实机 RPC 核验）：
 * - 官方安全页 https://aerodrome.finance/security 的部署清单
 * - GitHub https://github.com/aerodrome-finance/contracts
 * - GitHub https://github.com/aerodrome-finance/slipstream
 *
 * 以下地址均已在 Base Mainnet（chain_id=8453）链上实读核验（详见
 * scripts/verify-aerodrome.ts），核验方式：
 * - classic PoolFactory：读 allPoolsLength() + getPool(WETH,USDC,bool) 返回真实池子
 * - classic Router：读链上 code 非空
 * - CL PoolFactory：读 getPool(WETH,USDC,int24) 返回真实池子
 * - QuoterV2：读链上 code 非空 + quoteExactInputSingle 返回合理 amountOut
 * - 其余（NFPM / SwapRouter / UniversalRouter）来自官方清单，code 存在，
 *   但本 Sprint 未直接调用其业务函数（列为「仅核验存在性」）。
 *
 * 禁止编造：任何新地址必须走同样流程核验后再加入。
 */
import { BASE_MAINNET_CHAIN_ID } from '../../chain/chain.constants';

export const AERODROME_CHAIN_ID = BASE_MAINNET_CHAIN_ID; // 8453

/** classic（Velodrome v2 fork，含 volatile 恒定乘积池与 stable 池）。 */
export const AERODROME_CLASSIC_FACTORY =
  '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
export const AERODROME_CLASSIC_ROUTER =
  '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
export const AERODROME_FACTORY_REGISTRY =
  '0x5C3F18F06CC09CA1910767A34a20F771039E37C0';

/** Slipstream（集中流动性 CL，Uniswap v3 fork）。 */
export const AERODROME_CL_FACTORY =
  '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A';
export const AERODROME_QUOTER = '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0';
export const AERODROME_NONFUNGIBLE_POSITION_MANAGER =
  '0x827922686190790b37229fd06084350E74485b72';
export const AERODROME_SWAP_ROUTER =
  '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5';
export const AERODROME_UNIVERSAL_ROUTER =
  '0x6Cb442acF35158D5eDa88fe602221b67B400Be3E';

/**
 * CL 池常见 tickSpacing（升序）。discoverPools 会逐个用 getPool 探测，
 * 返回 address(0) 表示该 tickSpacing 下无池子，直接过滤。
 * 来源：Aerodrome Slipstream 官方 / 社区工具常用值。
 */
export const AERODROME_CL_TICK_SPACINGS = [1, 50, 100, 200, 2000] as const;

/** classic volatile 池默认费率 bps（0.30%）。 */
export const AERODROME_CLASSIC_VOLATILE_FEE_BPS = 30n;
/** classic stable 池默认费率 bps（0.05%）。 */
export const AERODROME_CLASSIC_STABLE_FEE_BPS = 5n;

/** 协议子类型标识（写入 dex_protocols.protocol_type）。 */
export const AERODROME_PROTOCOL_TYPE_CLASSIC = 'aerodrome_classic';
export const AERODROME_PROTOCOL_TYPE_CL = 'aerodrome_cl';

/** 规范化单位：1e6 = 100%。 */
export const PPM_SCALE = 1_000_000n;
/** bps -> ppm 换算：1 bps = 100 ppm。 */
export const BPS_TO_PPM = 100n;

/** 默认静态 Gas 估算（Sprint 3 不实现 eth_estimateGas 仿真，见 estimateGas 说明）。 */
export const DEFAULT_SWAP_GAS_LIMIT = 250_000n;
