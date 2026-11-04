/**
 * Token 种子数据：把 Base Mainnet 7 个真实 Token 写入数据库。
 *
 * 运行：pnpm --filter @vortex/api seed  （= tsx prisma/seed.ts）
 * 或：  pnpm --filter @vortex/api exec prisma db seed
 *
 * 元数据来源策略：
 * - 优先链上读取 name / symbol / decimals（真实值）
 * - RPC 因网络/代理不可达时，用目录里已核对的 symbol/name/decimals 兜底
 * - 两种来源均写入 Token.source 字段（onchain / fallback）并打印，做到可溯源
 *
 * 地址均为 Base Mainnet 真实合约地址，与前端 apps/web/src/config/tokens.ts 一致，禁止编造。
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  BASE_MAINNET_TOKENS,
  type TokenCatalogEntry,
} from '../src/chain/token-catalog';
import { DEFAULT_RPC_URLS } from '../src/chain/chain.constants';
import { normalizeAddress } from '../src/chain/address';

const prisma = new PrismaClient();

function clientFor(chainId: number): PublicClient {
  const chain = chainId === 8453 ? base : baseSepolia;
  const url =
    chainId === 8453
      ? process.env.BASE_MAINNET_RPC_URL ?? DEFAULT_RPC_URLS[8453]
      : process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_RPC_URLS[84532];
  return createPublicClient({
    chain,
    transport: http(url, { timeout: 10000, retryCount: 1 }),
    batch: { multicall: true },
  });
}

interface OnchainMeta {
  name: string;
  symbol: string;
  decimals: number;
}

async function readOnchainMeta(
  chainId: number,
  address: `0x${string}`,
): Promise<OnchainMeta> {
  const client = clientFor(chainId);
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
  ]);
  return {
    name: String(name),
    symbol: String(symbol),
    decimals: Number(decimals),
  };
}

async function upsertOne(entry: TokenCatalogEntry): Promise<void> {
  const addr = normalizeAddress(entry.address) as `0x${string}`;
  let meta: OnchainMeta = {
    name: entry.name,
    symbol: entry.symbol,
    decimals: entry.decimals,
  };
  let source: 'onchain' | 'fallback' = 'fallback';

  try {
    meta = await readOnchainMeta(entry.chainId, addr);
    source = 'onchain';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[seed] RPC 不可达，使用兜底元数据 ${entry.symbol}（chain=${entry.chainId}）: ${msg}`,
    );
  }

  await prisma.token.upsert({
    where: {
      chain_id_address: { chain_id: entry.chainId, address: addr },
    },
    update: {
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      logo_uri: entry.logoURI ?? null,
      is_verified: entry.verified,
      risk: entry.risk,
      source,
    },
    create: {
      chain_id: entry.chainId,
      address: addr,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      logo_uri: entry.logoURI ?? null,
      is_verified: entry.verified,
      risk: entry.risk,
      source,
    },
  });

  console.log(
    `[seed] upsert ${meta.symbol.padEnd(8)} ${addr} ` +
      `decimals=${meta.decimals} verified=${entry.verified} risk=${entry.risk} source=${source}`,
  );
}

async function main(): Promise<void> {
  console.log(`[seed] 开始写入 ${BASE_MAINNET_TOKENS.length} 个 Base Mainnet Token...`);
  for (const entry of BASE_MAINNET_TOKENS) {
    await upsertOne(entry);
  }

  const count = await prisma.token.count();
  console.log(`[seed] 完成，tokens 表当前共 ${count} 条记录`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed] FAILED');
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
