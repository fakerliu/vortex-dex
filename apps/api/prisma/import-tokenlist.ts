/**
 * Token List 导入脚本：从 Uniswap Labs Default token list 批量导入 Base 链 Token。
 *
 * 背景：项目此前只有 7 个精选 Token（手写 catalog），Explore 榜单数据很少。
 * 本脚本从权威第三方 token list 拉取 Base(8453) 全部 token（约 195 个），
 * 批量 upsert 进数据库 Token 表，大幅扩充币种覆盖面。
 *
 * 数据真实性策略（与项目「纯链上价格」卖点保持一致）：
 * - 元数据（地址/symbol/name/decimals/logoURI）来自 Uniswap Labs Default list，
 *   属于「第三方 token list」来源，source 标记为 'tokenlist'。
 * - 价格仍由 MarketService 链上推导，本脚本不写任何价格。
 * - 与现有 catalog 重叠的 token 保留 is_verified=true + 原 risk 标记（VIRTUAL 仍为 risk）。
 * - 新增 token 默认 is_verified=false（第三方收录 ≠ 项目方核验），risk=false。
 *
 * 运行：pnpm --filter @vortex/api tsx prisma/import-tokenlist.ts
 * 或：  cd apps/api && npx tsx prisma/import-tokenlist.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeAddress } from '../src/chain/address';
import { getCatalogEntry } from '../src/chain/token-catalog';
import { BASE_MAINNET_CHAIN_ID } from '../src/chain/chain.constants';

const prisma = new PrismaClient();

/** Uniswap Labs Default token list（权威、维护活跃、跨链含 Base）。 */
const TOKEN_LIST_URL = 'https://tokens.uniswap.org';
/** 只导入 Base Mainnet。 */
const TARGET_CHAIN_ID = BASE_MAINNET_CHAIN_ID; // 8453

interface TokenListItem {
  chainId: number;
  address: string;
  name?: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

interface TokenListResponse {
  name?: string;
  tokens: TokenListItem[];
}

async function fetchTokenList(): Promise<TokenListResponse> {
  const res = await fetch(TOKEN_LIST_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`拉取 token list 失败：HTTP ${res.status}`);
  }
  return (await res.json()) as TokenListResponse;
}

async function main(): Promise<void> {
  const list = await fetchTokenList();
  const baseTokens = list.tokens.filter((t) => t.chainId === TARGET_CHAIN_ID);

  console.log(
    `[import-tokenlist] 源 list「${list.name ?? TOKEN_LIST_URL}」共 ${list.tokens.length} 个 token，` +
      `其中 Base(${TARGET_CHAIN_ID}) ${baseTokens.length} 个`,
  );

  let imported = 0;
  let verifiedOverlap = 0;
  let skipped = 0;

  for (const t of baseTokens) {
    // 过滤明显非法的项（地址缺失 / 空 symbol）
    if (!t.address || !t.symbol || t.symbol.trim().length === 0) {
      console.warn(`[import-tokenlist] 跳过无地址/无 symbol 的项`);
      skipped++;
      continue;
    }

    const addr = normalizeAddress(t.address);
    // 与现有 catalog 重叠：保留 verified + risk 标记（项目方已核验的 7 个）
    const catalog = getCatalogEntry(TARGET_CHAIN_ID, addr);

    await prisma.token.upsert({
      where: { chain_id_address: { chain_id: TARGET_CHAIN_ID, address: addr } },
      update: {
        symbol: t.symbol,
        name: t.name ?? t.symbol,
        decimals: t.decimals,
        logo_uri: t.logoURI ?? null,
        // catalog 重叠项：保留原有 verified/risk；否则保持原值不覆盖（防止把人工核验结果冲掉）
        ...(catalog
          ? { is_verified: catalog.verified, risk: catalog.risk }
          : {}),
        source: catalog ? 'onchain' : 'tokenlist',
      },
      create: {
        chain_id: TARGET_CHAIN_ID,
        address: addr,
        symbol: t.symbol,
        name: t.name ?? t.symbol,
        decimals: t.decimals,
        logo_uri: t.logoURI ?? null,
        is_verified: catalog?.verified ?? false,
        risk: catalog?.risk ?? false,
        source: catalog ? 'onchain' : 'tokenlist',
      },
    });

    if (catalog) {
      verifiedOverlap++;
    }
    imported++;
  }

  const total = await prisma.token.count({
    where: { chain_id: TARGET_CHAIN_ID },
  });

  console.log(
    `[import-tokenlist] 完成：导入 ${imported} 个（与 catalog 重叠 ${verifiedOverlap} 个），` +
      `跳过 ${skipped} 个；Base 链 tokens 表现共 ${total} 条`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[import-tokenlist] FAILED');
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
