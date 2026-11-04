import type { Token } from "@/types/token";

/**
 * 合约地址来源：Base 官方 token list / 公开可信列表（已核对）。
 * 地址均为真实合约地址，禁止编造。
 * - Base Mainnet (8453) 地址来自 Base 官方 token list。
 * - Base Sepolia (84532) 地址来自 Uniswap V3 测试网部署（已用 cast 链上核验）。
 */
export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

const ADDRESSES = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
} as const;

/** Base Sepolia 测试代币地址（Uniswap V3 测试网，已链上核验 decimals）。 */
const SEPOLIA_ADDRESSES = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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

/**
 * Base Sepolia 测试代币列表（仅 WETH / USDC，供测试网真机闭环）。
 */
export const SEPOLIA_TOKENS: Token[] = [
  {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    address: SEPOLIA_ADDRESSES.WETH,
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    verified: true,
  },
  {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    address: SEPOLIA_ADDRESSES.USDC,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    verified: true,
  },
];

/** 全部可选代币（主网 + 测试网）。 */
export const ALL_TOKENS: Token[] = [...DEFAULT_TOKENS, ...SEPOLIA_TOKENS];

/** 按链 ID 取可选代币列表。 */
export function getTokensByChain(chainId: number): Token[] {
  return ALL_TOKENS.filter((t) => t.chainId === chainId);
}

/** 某链上的默认支付/接收代币（缺省回退到主网）。 */
export function getDefaultTokensForChain(
  chainId: number,
): { pay: Token; receive: Token } {
  const tokens = getTokensByChain(chainId);
  const pay = tokens.find((t) => t.symbol === "WETH");
  const receive = tokens.find((t) => t.symbol === "USDC");
  if (pay && receive) return { pay, receive };
  return { pay: DEFAULT_PAY_TOKEN, receive: DEFAULT_RECEIVE_TOKEN };
}

export function getTokenByAddress(
  address: string,
  chainId: number = BASE_CHAIN_ID,
): Token | undefined {
  const lower = address.toLowerCase();
  return ALL_TOKENS.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === lower,
  );
}
