import type { Token } from "@/types/token";

/**
 * 合约地址来源：Base 官方 token list / 公开可信列表（已核对）。
 * 地址均为真实 Base Mainnet 合约地址，禁止编造。
 */
export const BASE_CHAIN_ID = 8453;

const ADDRESSES = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
} as const;

/**
 * Token Logo 统一走 Trust Wallet assets（按链 + 校验和地址寻址）。
 * 加载失败时由 <TokenIcon /> 回退为 Symbol 首字母。
 */
function twLogo(address: string): string {
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${address}/logo.png`;
}

/**
 * 默认精选代币列表（Base Mainnet）。
 * 说明：Phase 1 使用 WETH 代表 ETH（后续可扩展原生 ETH 余额读取）。
 */
export const DEFAULT_TOKENS: Token[] = [
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.WETH,
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    logoURI: twLogo(ADDRESSES.WETH),
    verified: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.USDC,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoURI: twLogo(ADDRESSES.USDC),
    verified: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.DAI,
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    logoURI: twLogo(ADDRESSES.DAI),
    verified: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.USDT,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logoURI: twLogo(ADDRESSES.USDT),
    verified: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.cbBTC,
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    decimals: 8,
    logoURI: twLogo(ADDRESSES.cbBTC),
    verified: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.AERO,
    symbol: "AERO",
    name: "Aerodrome",
    decimals: 18,
    logoURI: twLogo(ADDRESSES.AERO),
    verified: true,
  },
  {
    chainId: BASE_CHAIN_ID,
    address: ADDRESSES.VIRTUAL,
    symbol: "VIRTUAL",
    name: "Virtuals Protocol",
    decimals: 18,
    logoURI: twLogo(ADDRESSES.VIRTUAL),
    verified: true,
    risk: true,
  },
];

export const DEFAULT_PAY_TOKEN = DEFAULT_TOKENS.find(
  (t) => t.symbol === "WETH",
)!;
export const DEFAULT_RECEIVE_TOKEN = DEFAULT_TOKENS.find(
  (t) => t.symbol === "USDC",
)!;

export function getTokenByAddress(
  address: string,
  chainId: number = BASE_CHAIN_ID,
): Token | undefined {
  const lower = address.toLowerCase();
  return DEFAULT_TOKENS.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === lower,
  );
}
