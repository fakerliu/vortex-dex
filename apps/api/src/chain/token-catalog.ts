/**
 * 精选代币目录（Base Mainnet 真实合约地址，已核对，禁止编造）。
 * 与前端 apps/web/src/config/tokens.ts 保持一致。
 * 用途：
 * - seed 脚本据此把 7 个真实 Token 写入数据库
 * - TokenService.upsertToken 据此打 verified / risk 标记
 */
import { BASE_MAINNET_CHAIN_ID } from './chain.constants';

export interface TokenCatalogEntry {
  chainId: number;
  address: string; // 校验和地址
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  risk: boolean;
  logoURI?: string;
}

function twLogo(address: string): string {
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${address}/logo.png`;
}

export const BASE_MAINNET_TOKENS: TokenCatalogEntry[] = [
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    verified: true,
    risk: false,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    verified: true,
    risk: false,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    verified: true,
    risk: false,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    verified: true,
    risk: false,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    decimals: 8,
    verified: true,
    risk: false,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    symbol: 'AERO',
    name: 'Aerodrome',
    decimals: 18,
    verified: true,
    risk: false,
  },
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    symbol: 'VIRTUAL',
    name: 'Virtuals Protocol',
    decimals: 18,
    verified: true,
    risk: true, // 前端标记 risk:true
  },
].map((t) => ({ ...t, logoURI: twLogo(t.address) }));

export function getCatalogEntry(
  chainId: number,
  address: string,
): TokenCatalogEntry | undefined {
  const lower = address.toLowerCase();
  return BASE_MAINNET_TOKENS.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === lower,
  );
}
