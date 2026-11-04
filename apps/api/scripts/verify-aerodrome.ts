/**
 * Aerodrome Adapter 链上核验脚本（Sprint 3）。
 *
 * 运行：pnpm --filter @vortex/api exec tsx scripts/verify-aerodrome.ts
 *
 * 实际连 Base Mainnet 核验：
 * 1. factory / router / quoter 地址真实（链上 code 非空 + 功能调用）
 * 2. 能发现真实池子（WETH-USDC 的 classic volatile/stable + CL 各 tickSpacing）
 * 3. 能读 reserves / liquidity / tick / sqrtPriceX96
 * 4. 报价交叉验证：
 *    - classic volatile：本地恒定乘积公式 vs 链上 pool.getAmountOut（必须一致）
 *    - classic stable：链上 getAmountOut
 *    - CL：官方 QuoterV2.quoteExactInputSingle
 * 5. 把协议 + 发现的池子幂等写入 dex_protocols / pools 表
 *
 * 禁止编造：所有地址均为官方清单 + 本脚本链上实读核验结果。
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { ChainRpcService } from '../src/chain/chain-rpc.service';
import { BASE_MAINNET_CHAIN_ID } from '../src/chain/chain.constants';
import { AerodromeClassicAdapter } from '../src/dex/aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from '../src/dex/aerodrome/aerodrome-cl.adapter';
import {
  aerodromeClassicPoolAbi,
} from '../src/dex/aerodrome/abis';
import {
  AERODROME_CLASSIC_FACTORY,
  AERODROME_CLASSIC_ROUTER,
  AERODROME_CL_FACTORY,
  AERODROME_QUOTER,
} from '../src/dex/aerodrome/constants';
import { formatUnits } from '../src/common/utils/units';

const RPC_URL =
  process.env.BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org';

// Base Mainnet 已核对代币地址（与 token-catalog 一致）
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const prisma = new PrismaClient();
const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function hr(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  const rpc = new ChainRpcService();
  const classic = new AerodromeClassicAdapter(rpc);
  const cl = new AerodromeClAdapter(rpc);
  const client = rpc.getClient(BASE_MAINNET_CHAIN_ID);

  // 供交叉验证的独立 viem client（避免与 adapter 共用同一 transport 实例的疑虑）
  const rawClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL, { timeout: 15000, retryCount: 1 }),
    batch: { multicall: true },
  });

  // ---------- 1. 地址核验 ----------
  hr('1. 合约地址核验（链上 code 非空 + 功能调用）');
  const contracts = [
    ['classic PoolFactory', AERODROME_CLASSIC_FACTORY],
    ['classic Router', AERODROME_CLASSIC_ROUTER],
    ['CL PoolFactory', AERODROME_CL_FACTORY],
    ['QuoterV2', AERODROME_QUOTER],
  ] as const;
  for (const [label, addr] of contracts) {
    const code = await rawClient.getCode({ address: addr as `0x${string}` });
    const ok = code !== undefined && code !== '0x';
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label} ${addr} code=${ok ? 'non-empty' : 'EMPTY'}`);
    if (!ok) {
      throw new Error(`${label} 地址无合约代码，核验失败`);
    }
  }

  const allPoolsLength = (await rawClient.readContract({
    address: AERODROME_CLASSIC_FACTORY as `0x${string}`,
    abi: [
      {
        inputs: [],
        name: 'allPoolsLength',
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'allPoolsLength',
  })) as bigint;
  console.log(`  classic PoolFactory.allPoolsLength() = ${allPoolsLength}`);

  // ---------- 2. 协议信息 ----------
  hr('2. 协议信息');
  const classicInfo = await classic.getProtocolInfo();
  const clInfo = await cl.getProtocolInfo();
  console.log(`  classic: protocol_type=${classicInfo.protocolType} version=${classicInfo.version}`);
  console.log(`           factory=${classicInfo.factoryAddress}`);
  console.log(`           router=${classicInfo.routerAddress}`);
  console.log(`  CL     : protocol_type=${clInfo.protocolType} version=${clInfo.version}`);
  console.log(`           factory=${clInfo.factoryAddress}`);
  console.log(`           quoter=${clInfo.quoterAddress}`);

  // ---------- 3. 池子发现 ----------
  hr('3. 池子发现（WETH-USDC）');
  const [classicPools, clPools] = await Promise.all([
    classic.discoverPools(WETH, USDC),
    cl.discoverPools(WETH, USDC),
  ]);
  console.log(`  classic 池 ${classicPools.length} 个：`);
  for (const p of classicPools) {
    console.log(`    - ${p.kind} ${p.address} fee=${p.fee}ppm feeRaw=${p.feeRaw}`);
  }
  console.log(`  CL 池 ${clPools.length} 个：`);
  for (const p of clPools) {
    console.log(`    - cl ts=${p.tickSpacing} ${p.address} fee=${p.fee}ppm`);
  }
  if (classicPools.length === 0 && clPools.length === 0) {
    throw new Error('未发现任何 WETH-USDC 池子，核验失败');
  }

  // ---------- 4. 池子状态 ----------
  hr('4. 池子状态读取');
  for (const p of classicPools) {
    const s = await classic.getPoolState(p.address);
    console.log(
      `  [${s.kind}] ${s.address}`,
    );
    console.log(
      `    token0=${s.token0} token1=${s.token1} fee=${s.fee}ppm block=${s.blockNumber}`,
    );
    console.log(
      `    reserve0=${s.reserve0} reserve1=${s.reserve1} totalSupply=${s.totalSupply}`,
    );
  }
  for (const p of clPools) {
    const s = await cl.getPoolState(p.address);
    console.log(`  [cl ts=${s.tickSpacing}] ${s.address}`);
    console.log(
      `    token0=${s.token0} token1=${s.token1} fee=${s.fee}ppm ` +
        `liquidity=${s.liquidity} tick=${s.tick} dynamicFee=${s.dynamicFee}`,
    );
    console.log(`    sqrtPriceX96=${s.sqrtPriceX96} block=${s.blockNumber}`);
  }

  // ---------- 5. 报价 + 交叉验证 ----------
  hr('5. 报价交叉验证（1 WETH -> USDC）');
  const ONE_WETH = (10n ** 18n).toString();

  // 5a. classic volatile：本地公式 vs 链上 getAmountOut
  const volPool = classicPools.find((p) => p.kind === 'classic-volatile');
  if (volPool) {
    const q = await classic.getQuote({
      chainId: BASE_MAINNET_CHAIN_ID,
      poolAddress: volPool.address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: ONE_WETH,
    });
    const onchain = (await rawClient.readContract({
      address: volPool.address as `0x${string}`,
      abi: aerodromeClassicPoolAbi,
      functionName: 'getAmountOut',
      args: [BigInt(ONE_WETH), WETH as `0x${string}`],
    })) as bigint;
    const match = q.amountOut === onchain.toString();
    console.log(`  [classic-volatile] ${volPool.address}`);
    console.log(`    amountIn      = ${q.amountIn} (1 WETH)`);
    console.log(`    amountOut公式  = ${q.amountOut} USDC = ${formatUnits(q.amountOut, 6)}`);
    console.log(`    amountOut链上  = ${onchain} USDC = ${formatUnits(onchain.toString(), 6)}`);
    console.log(`    一致           = ${match}`);
    console.log(`    priceImpact    = ${q.priceImpact}`);
    console.log(`    source         = ${q.source}`);
    if (!match) {
      throw new Error('classic volatile 恒定乘积公式与链上 getAmountOut 不一致');
    }
  }

  // 5b. classic stable：链上 getAmountOut
  const stPool = classicPools.find((p) => p.kind === 'classic-stable');
  if (stPool) {
    const q = await classic.getQuote({
      chainId: BASE_MAINNET_CHAIN_ID,
      poolAddress: stPool.address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: ONE_WETH,
    });
    console.log(`  [classic-stable] ${stPool.address}`);
    console.log(`    amountOut   = ${q.amountOut} USDC = ${formatUnits(q.amountOut, 6)}`);
    console.log(`    priceImpact = ${q.priceImpact} (近似)`);
    console.log(`    source      = ${q.source}`);
  }

  // 5c. CL：官方 Quoter
  for (const p of clPools) {
    const q = await cl.getQuote({
      chainId: BASE_MAINNET_CHAIN_ID,
      poolAddress: p.address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: ONE_WETH,
    });
    console.log(`  [cl ts=${p.tickSpacing}] ${p.address}`);
    console.log(`    amountOut   = ${q.amountOut} USDC = ${formatUnits(q.amountOut, 6)}`);
    console.log(`    priceImpact = ${q.priceImpact} (近似)`);
    console.log(`    source      = ${q.source}`);
    const gas = await cl.estimateGas({
      chainId: BASE_MAINNET_CHAIN_ID,
      poolAddress: p.address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: ONE_WETH,
    });
    console.log(`    gasEstimate = ${gas.gasLimit} (${gas.source})`);
  }

  // ---------- 6. 落库 ----------
  hr('6. 写入 dex_protocols / pools');
  const [classicProto, clProto] = await Promise.all([
    prisma.dexProtocol.upsert({
      where: {
        chain_id_name_version: {
          chain_id: BASE_MAINNET_CHAIN_ID,
          name: classicInfo.name,
          version: classicInfo.version,
        },
      },
      update: {
        protocol_type: classicInfo.protocolType,
        factory_address: classicInfo.factoryAddress,
        router_address: classicInfo.routerAddress,
        quoter_address: classicInfo.quoterAddress,
        is_enabled: true,
      },
      create: {
        chain_id: BASE_MAINNET_CHAIN_ID,
        name: classicInfo.name,
        protocol_type: classicInfo.protocolType,
        version: classicInfo.version,
        factory_address: classicInfo.factoryAddress,
        router_address: classicInfo.routerAddress,
        quoter_address: classicInfo.quoterAddress,
        is_enabled: true,
      },
    }),
    prisma.dexProtocol.upsert({
      where: {
        chain_id_name_version: {
          chain_id: BASE_MAINNET_CHAIN_ID,
          name: clInfo.name,
          version: clInfo.version,
        },
      },
      update: {
        protocol_type: clInfo.protocolType,
        factory_address: clInfo.factoryAddress,
        router_address: clInfo.routerAddress,
        quoter_address: clInfo.quoterAddress,
        is_enabled: true,
      },
      create: {
        chain_id: BASE_MAINNET_CHAIN_ID,
        name: clInfo.name,
        protocol_type: clInfo.protocolType,
        version: clInfo.version,
        factory_address: clInfo.factoryAddress,
        router_address: clInfo.routerAddress,
        quoter_address: clInfo.quoterAddress,
        is_enabled: true,
      },
    }),
  ]);
  console.log(`  dex_protocols: classic id=${classicProto.id} cl id=${clProto.id}`);

  for (const p of classicPools) {
    const s = await classic.getPoolState(p.address);
    await prisma.pool.upsert({
      where: {
        chain_id_pool_address: {
          chain_id: BASE_MAINNET_CHAIN_ID,
          pool_address: s.address,
        },
      },
      update: {
        protocol_id: classicProto.id,
        token0_address: s.token0,
        token1_address: s.token1,
        fee: d(s.fee),
        liquidity: d(s.totalSupply ?? '0'),
        reserve0: d(s.reserve0 ?? '0'),
        reserve1: d(s.reserve1 ?? '0'),
        last_synced_block: s.blockNumber,
      },
      create: {
        chain_id: BASE_MAINNET_CHAIN_ID,
        protocol_id: classicProto.id,
        token0_address: s.token0,
        token1_address: s.token1,
        fee: d(s.fee),
        pool_address: s.address,
        liquidity: d(s.totalSupply ?? '0'),
        reserve0: d(s.reserve0 ?? '0'),
        reserve1: d(s.reserve1 ?? '0'),
        last_synced_block: s.blockNumber,
      },
    });
    console.log(`  pools upsert: [classic] ${s.address}`);
  }
  for (const p of clPools) {
    const s = await cl.getPoolState(p.address);
    await prisma.pool.upsert({
      where: {
        chain_id_pool_address: {
          chain_id: BASE_MAINNET_CHAIN_ID,
          pool_address: s.address,
        },
      },
      update: {
        protocol_id: clProto.id,
        token0_address: s.token0,
        token1_address: s.token1,
        fee: d(s.fee),
        liquidity: d(s.liquidity ?? '0'),
        reserve0: d('0'),
        reserve1: d('0'),
        last_synced_block: s.blockNumber,
      },
      create: {
        chain_id: BASE_MAINNET_CHAIN_ID,
        protocol_id: clProto.id,
        token0_address: s.token0,
        token1_address: s.token1,
        fee: d(s.fee),
        pool_address: s.address,
        liquidity: d(s.liquidity ?? '0'),
        reserve0: d('0'),
        reserve1: d('0'),
        last_synced_block: s.blockNumber,
      },
    });
    console.log(`  pools upsert: [cl ts=${s.tickSpacing}] ${s.address}`);
  }

  const poolCount = await prisma.pool.count({
    where: { chain_id: BASE_MAINNET_CHAIN_ID },
  });
  const protoCount = await prisma.dexProtocol.count({
    where: { chain_id: BASE_MAINNET_CHAIN_ID },
  });
  console.log(`\n完成。dex_protocols=${protoCount} 条，pools=${poolCount} 条（Base Mainnet）`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('VERIFY-AERODROME PASSED');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nVERIFY-AERODROME FAILED');
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
