/**
 * Uniswap V3（Base Sepolia 测试网）合约地址与协议元信息。
 *
 * 来源与核验（2026-11，team-lead 已用 cast 在 https://sepolia.base.org 实读核验，勿重验）：
 * - Factory    0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24（getPool(WETH,USDC,500) 返回真实池 0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0）
 * - SwapRouter02 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4（code 存在，标准 0x60806040）
 * - QuoterV2   0xC5290058841028F1614F3A6F0F5816cAd0df5E27（code 存在，含 factory() selector c45a0155）
 * - WETH       0x4200000000000000000000000000000000000006（decimals 18）
 * - USDC(测试) 0x036CbD53842c5426634e7929541eC2318f3dCF7e（decimals 6）
 *
 * 与 Aerodrome CL 的关键差异（决定本适配器写法）：
 * - Factory getPool(address,address,uint24 fee)：第三参是 uint24 fee，不是 int24 tickSpacing。
 * - Pool 维度是 fee()（uint24）；Uniswap V3 池没有 tickSpacing()。
 * - QuoterV2 quoteExactInputSingle 结构体第 4 字段是 uint24 fee。
 * - slot0 是 7 元组（含 feeProtocol 与 unlocked），不是 Aerodrome 的 6 元组。
 */
import { BASE_SEPOLIA_CHAIN_ID } from '../../chain/chain.constants';

/** Uniswap V3 只部署在 Base Sepolia（84532）测试网。 */
export const UNISWAP_V3_CHAIN_ID = BASE_SEPOLIA_CHAIN_ID; // 84532

export const UNISWAP_V3_FACTORY =
  '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
export const UNISWAP_V3_SWAP_ROUTER =
  '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4';
export const UNISWAP_V3_QUOTER =
  '0xC5290058841028F1614F3A6F0F5816cAd0df5E27';

/** 常见 Uniswap V3 fee tier（uint24，升序）。discoverPools 逐个 getPool 探测。 */
export const UNISWAP_V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

/** 协议子类型标识（写入 dex_protocols.protocol_type）。 */
export const UNISWAP_V3_PROTOCOL_TYPE = 'uniswap_v3';

/** 默认静态 Gas 估算（Quoter 仿真失败时兜底）。 */
export const UNISWAP_V3_DEFAULT_GAS_LIMIT = 250_000n;
