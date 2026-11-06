/**
 * 全量池发现脚本（D1：链上遍历，不用 subgraph）。
 *
 * 运行：pnpm --filter @vortex/api exec tsx scripts/discover-all-pools.ts
 *
 * 数据流：Factory.allPoolsLength() → Factory.allPools(i) 枚举池地址（multicall 分批）
 *         → Pool.token0()/token1() 读取代币（multicall 分批）
 *         → 幂等写入 pools 表（最小集 token0/token1，fee/liquidity/reserve 填 0）。
 *
 * 断点续传：把每个 factory 已遍历到的 index 写入本地 checkpoint JSON
 *           （默认 .discover-pools-checkpoint.json，已 gitignore），
 *           重跑时从 checkpoint 继续，不重复枚举。
 *
 * 覆盖范围（Base Mainnet，已链上实测）：
 * - classic Factory 0x420D...0Da：allPoolsLength() ≈ 29903
 * - CL Factory     0x5e7B...09A：allPoolsLength() ≈ 3680
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPublicClient, http, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_MAINNET_CHAIN_ID } from '../src/chain/chain.constants';
import {
  AERODROME_CLASSIC_FACTORY,
  AERODROME_CL_FACTORY,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
  AERODROME_PROTOCOL_TYPE_CL,
} from '../src/dex/aerodrome/constants';
import {
  aerodromeClassicFactoryAbi,
  aerodromeClFactoryAbi,
  aerodromeClassicPoolAbi,
  aerodromeClPoolAbi,
} from '../src/dex/aerodrome/abis';

const CHAIN_ID = BASE_MAINNET_CHAIN_ID;

/** 单次 multicall 枚举池地址的条数。 */
const ADDR_BATCH = 500;
/** 单次 multicall 读取 token0/token1 的池子数（每池 2 个 view 调用）。 */
const TOKEN_BATCH = 250;
/** 单次 createMany 落库的池子条数。 */
const DB_BATCH = 1000;

const CHECKPOINT_PATH = join(process.cwd(), '.discover-pools-checkpoint.json');

type Call = {
  address: `0x${string}`;
  abi: unknown;
  functionName: string;
  args?: unknown[];
};

type CallResult = { status: 'success' | 'failure'; result?: unknown };

interface FactoryCheckpoint {
  total: number;
  next: number;
}

interface Checkpoint {
  classic: FactoryCheckpoint;
  cl: FactoryCheckpoint;
}

interface PoolRow {
  address: string;
  token0: string;
  token1: string;
}

interface FactorySpec {
  label: string;
  factory: `0x${string}`;
  factoryAbi: unknown;
  poolAbi: unknown;
  protocolId: string;
  checkpointKey: 'classic' | 'cl';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRpcUrl(): string {
  if (process.env.BASE_MAINNET_RPC_URL) {
    return process.env.BASE_MAINNET_RPC_URL;
  }
  const first = (process.env.INDEXER_RPC_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.startsWith('http'));
  return first ?? 'https://mainnet.base.org';
}

function loadCheckpoint(): Checkpoint {
  const empty: Checkpoint = {
    classic: { total: 0, next: 0 },
    cl: { total: 0, next: 0 },
  };
  if (!existsSync(CHECKPOINT_PATH)) {
    return empty;
  }
  try {
    const raw = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) as Checkpoint;
    return {
      classic: raw.classic ?? empty.classic,
      cl: raw.cl ?? empty.cl,
    };
  } catch {
    return empty;
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2), 'utf8');
}

/** multicall 统一入口：整批 throw 时重试 2 次；单条失败由调用方二次补读。 */
async function multicall(
  client: PublicClient,
  contracts: Call[],
): Promise<CallResult[]> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return (await client.multicall({
        contracts: contracts as never,
        allowFailure: true,
      })) as CallResult[];
    } catch (err) {
      if (attempt === 2) {
        throw err;
      }
      await sleep(500 * attempt);
    }
  }
  throw new Error('unreachable');
}

/** 幂等 upsert 协议记录，返回 protocol_id。 */
async function upsertProtocol(
  prisma: PrismaClient,
  info: {
    name: string;
    protocolType: string;
    version: string;
    factoryAddress: string;
  },
): Promise<string> {
  const row = await prisma.dexProtocol.upsert({
    where: {
      chain_id_name_version: {
        chain_id: CHAIN_ID,
        name: info.name,
        version: info.version,
      },
    },
    update: {
      protocol_type: info.protocolType,
      factory_address: info.factoryAddress,
      is_enabled: true,
    },
    create: {
      chain_id: CHAIN_ID,
      name: info.name,
      protocol_type: info.protocolType,
      version: info.version,
      factory_address: info.factoryAddress,
      is_enabled: true,
    },
  });
  return row.id;
}

async function readAllPoolsLength(
  client: PublicClient,
  factory: `0x${string}`,
  abi: unknown,
): Promise<number> {
  const raw = (await client.readContract({
    address: factory,
    abi: abi as never,
    functionName: 'allPoolsLength',
  } as never)) as bigint;
  return Number(raw);
}

async function readAddresses(
  client: PublicClient,
  factory: `0x${string}`,
  abi: unknown,
  from: number,
  to: number,
): Promise<string[]> {
  const contracts: Call[] = [];
  for (let i = from; i < to; i++) {
    contracts.push({ address: factory, abi, functionName: 'allPools', args: [i] });
  }
  const res = await multicall(client, contracts);

  // 二次补读失败项
  const failedIdx = res
    .map((r, k) => (r.status === 'success' ? -1 : k))
    .filter((k) => k >= 0);
  if (failedIdx.length > 0) {
    const retryRes = await multicall(
      client,
      failedIdx.map((k) => contracts[k]),
    );
    failedIdx.forEach((k, j) => {
      res[k] = retryRes[j];
    });
  }

  const out: string[] = [];
  res.forEach((r) => {
    if (r.status === 'success' && typeof r.result === 'string') {
      out.push((r.result as string).toLowerCase());
    } else {
      console.warn(`  [warn] allPools 读取失败（已重试）: index=${from + res.indexOf(r)}`);
    }
  });
  return out;
}

async function readTokenPairs(
  client: PublicClient,
  poolAbi: unknown,
  addresses: string[],
): Promise<PoolRow[]> {
  const out: PoolRow[] = [];
  for (let i = 0; i < addresses.length; i += TOKEN_BATCH) {
    const chunk = addresses.slice(i, i + TOKEN_BATCH);
    const contracts: Call[] = [];
    for (const addr of chunk) {
      contracts.push({ address: addr as `0x${string}`, abi: poolAbi, functionName: 'token0' });
      contracts.push({ address: addr as `0x${string}`, abi: poolAbi, functionName: 'token1' });
    }
    const res = await multicall(client, contracts);

    // 二次补读失败的池（token0/token1 任一失败）
    const failedPools: number[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const t0 = res[j * 2];
      const t1 = res[j * 2 + 1];
      const ok =
        t0?.status === 'success' &&
        t1?.status === 'success' &&
        typeof t0.result === 'string' &&
        typeof t1.result === 'string';
      if (!ok) {
        failedPools.push(j);
      }
    }
    if (failedPools.length > 0) {
      const retryContracts: Call[] = [];
      for (const j of failedPools) {
        retryContracts.push({ address: chunk[j] as `0x${string}`, abi: poolAbi, functionName: 'token0' });
        retryContracts.push({ address: chunk[j] as `0x${string}`, abi: poolAbi, functionName: 'token1' });
      }
      const retryRes = await multicall(client, retryContracts);
      failedPools.forEach((j, k) => {
        res[j * 2] = retryRes[k * 2];
        res[j * 2 + 1] = retryRes[k * 2 + 1];
      });
    }

    for (let j = 0; j < chunk.length; j++) {
      const t0 = res[j * 2];
      const t1 = res[j * 2 + 1];
      if (
        t0?.status === 'success' &&
        t1?.status === 'success' &&
        typeof t0.result === 'string' &&
        typeof t1.result === 'string'
      ) {
        out.push({
          address: chunk[j],
          token0: (t0.result as string).toLowerCase(),
          token1: (t1.result as string).toLowerCase(),
        });
      } else {
        console.warn(`  [warn] 池 token 读取失败（已重试）: ${chunk[j]}`);
      }
    }
  }
  return out;
}

async function insertPools(
  prisma: PrismaClient,
  protocolId: string,
  headBlock: number,
  rows: PoolRow[],
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += DB_BATCH) {
    const batch = rows.slice(i, i + DB_BATCH);
    const res = await prisma.pool.createMany({
      data: batch.map((p) => ({
        chain_id: CHAIN_ID,
        protocol_id: protocolId,
        token0_address: p.token0,
        token1_address: p.token1,
        fee: new Prisma.Decimal('0'),
        pool_address: p.address,
        liquidity: new Prisma.Decimal('0'),
        reserve0: new Prisma.Decimal('0'),
        reserve1: new Prisma.Decimal('0'),
        last_synced_block: headBlock,
      })),
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  return inserted;
}

async function discoverFactory(
  client: PublicClient,
  prisma: PrismaClient,
  headBlock: number,
  spec: FactorySpec,
): Promise<{ total: number; inserted: number }> {
  const cp = loadCheckpoint();
  const total = await readAllPoolsLength(client, spec.factory, spec.factoryAbi);

  let next = cp[spec.checkpointKey]?.next ?? 0;
  if (next < 0 || next > total) {
    next = 0;
  }

  console.log(`[${spec.label}] allPoolsLength=${total}，从 index=${next} 继续`);

  let inserted = 0;
  while (next < total) {
    const to = Math.min(total, next + ADDR_BATCH);
    const addresses = await readAddresses(
      client,
      spec.factory,
      spec.factoryAbi,
      next,
      to,
    );
    const rows = await readTokenPairs(client, spec.poolAbi, addresses);
    inserted += await insertPools(prisma, spec.protocolId, headBlock, rows);

    next = to;
    cp[spec.checkpointKey] = { total, next };
    saveCheckpoint(cp);
    console.log(`[${spec.label}] 进度 ${next}/${total}（本批落库 ${rows.length}）`);
  }

  cp[spec.checkpointKey] = { total, next };
  saveCheckpoint(cp);
  return { total, inserted };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const client = createPublicClient({
    chain: base,
    transport: http(resolveRpcUrl(), { timeout: 20_000, retryCount: 1 }),
    batch: { multicall: true },
  }) as PublicClient;

  try {
    const head = Number(await client.getBlockNumber());
    console.log(`链上最新区块 = ${head}，RPC = ${resolveRpcUrl()}`);

    const classicId = await upsertProtocol(prisma, {
      name: 'Aerodrome',
      protocolType: AERODROME_PROTOCOL_TYPE_CLASSIC,
      version: 'v1',
      factoryAddress: AERODROME_CLASSIC_FACTORY.toLowerCase(),
    });
    const clId = await upsertProtocol(prisma, {
      name: 'Aerodrome',
      protocolType: AERODROME_PROTOCOL_TYPE_CL,
      version: 'v1-sl',
      factoryAddress: AERODROME_CL_FACTORY.toLowerCase(),
    });
    console.log(`protocol_id: classic=${classicId} cl=${clId}`);

    const classicSpec: FactorySpec = {
      label: 'classic',
      factory: AERODROME_CLASSIC_FACTORY as `0x${string}`,
      factoryAbi: aerodromeClassicFactoryAbi,
      poolAbi: aerodromeClassicPoolAbi,
      protocolId: classicId,
      checkpointKey: 'classic',
    };
    const clSpec: FactorySpec = {
      label: 'cl',
      factory: AERODROME_CL_FACTORY as `0x${string}`,
      factoryAbi: aerodromeClFactoryAbi,
      poolAbi: aerodromeClPoolAbi,
      protocolId: clId,
      checkpointKey: 'cl',
    };

    const classic = await discoverFactory(client, prisma, head, classicSpec);
    const cl = await discoverFactory(client, prisma, head, clSpec);

    const poolCount = await prisma.pool.count({ where: { chain_id: CHAIN_ID } });
    console.log(
      `\n完成：classic=${classic.total} cl=${cl.total}，本次新写入 ${classic.inserted + cl.inserted}，pools 表当前共 ${poolCount} 条`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('DISCOVER-ALL-POOLS PASSED');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nDISCOVER-ALL-POOLS FAILED');
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
