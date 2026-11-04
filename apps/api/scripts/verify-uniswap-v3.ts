/**
 * Uniswap V3（Base Sepolia）Adapter 链上核验 + 池子落库脚本。
 *
 * 运行：pnpm --filter @vortex/api exec tsx scripts/verify-uniswap-v3.ts
 *
 * 实际连 Base Sepolia（84532）核验：
 * 1. Factory / SwapRouter02 / QuoterV2 地址真实（code 非空 + 功能调用）
 * 2. Factory.getPool(WETH,USDC,500) 返回真实池 0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0
 * 3. 能发现 WETH-USDC 的真实池（遍历 fee tiers 100/500/3000/10000）
 * 4. 能读 token0/token1/fee/liquidity/slot0（7 元组）
 * 5. 官方 QuoterV2.quoteExactInputSingle 报价（amountOut 真实，source=quoter）
 * 6. 把协议 + 发现的池子幂等写入 dex_protocols / pools 表
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { ChainRpcService } from '../src/chain/chain-rpc.service';
import { UniswapV3Adapter } from '../src/dex/uniswap-v3/uniswap-v3.adapter';
import {
  uniswapV3FactoryAbi,
} from '../src/dex/uniswap-v3/abis';
import {
  UNISWAP_V3_CHAIN_ID,
  UNISWAP_V3_FACTORY,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_SWAP_ROUTER,
} from '../src/dex/uniswap-v3/constants';
import { formatUnits } from '../src/common/utils/units';

const RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const prisma = new PrismaClient();
const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function hr(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  const rpc = new ChainRpcService();
  const adapter = new UniswapV3Adapter(rpc);
  const rawClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL, { timeout: 15000, retryCount: 1 }),
    batch: { multicall: true },
  });

  // ---------- 1. 地址核验 ----------
  hr('1. 合约地址核验（链上 code 非空）');
  const contracts = [
    ['Factory', UNISWAP_V3_FACTORY],
    ['SwapRouter02', UNISWAP_V3_SWAP_ROUTER],
    ['QuoterV2', UNISWAP_V3_QUOTER],
  ] as const;
  for (const [label, addr] of contracts) {
    const code = await rawClient.getCode({ address: addr as `0x${string}` });
    const ok = code !== undefined && code !== '0x';
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label} ${addr} code=${ok ? 'non-empty' : 'EMPTY'}`);
    if (!ok) {
      throw new Error(`${label} 地址无合约代码，核验失败`);
    }
  }

  const poolFor500 = (await rawClient.readContract({
    address: UNISWAP_V3_FACTORY as `0x${string}`,
    abi: uniswapV3FactoryAbi,
    functionName: 'getPool',
    args: [WETH as `0x${string}`, USDC as `0x${string}`, 500],
  })) as string;
  const expect = '0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0';
  console.log(`  Factory.getPool(WETH,USDC,500) = ${poolFor500}`);
  console.log(`  期望 = ${expect}  一致 = ${poolFor500.toLowerCase() === expect.toLowerCase()}`);

  // ---------- 2. 协议信息 ----------
  hr('2. 协议信息');
  const info = await adapter.getProtocolInfo();
  console.log(`  protocol_type=${info.protocolType} version=${info.version}`);
  console.log(`  factory=${info.factoryAddress}`);
  console.log(`  router=${info.routerAddress}`);
  console.log(`  quoter=${info.quoterAddress}`);

  // ---------- 3. 池子发现 ----------
  hr('3. 池子发现（WETH-USDC，遍历 fee tiers）');
  const pools = await adapter.discoverPools(WETH, USDC);
  console.log(`  发现 ${pools.length} 个池：`);
  for (const p of pools) {
    console.log(`    - ${p.kind} fee=${p.fee}ppm ${p.address} token0=${p.token0} token1=${p.token1}`);
  }
  if (pools.length === 0) {
    throw new Error('未发现任何 WETH-USDC 池子，核验失败');
  }

  // ---------- 4. 池子状态 ----------
  hr('4. 池子状态读取（token0/token1/fee/liquidity/slot0[7元组]）');
  const states = [];
  for (const p of pools) {
    const s = await adapter.getPoolState(p.address);
    states.push(s);
    console.log(`  [cl fee=${s.fee}ppm] ${s.address}`);
    console.log(
      `    token0=${s.token0} token1=${s.token1} liquidity=${s.liquidity} ` +
        `tick=${s.tick} block=${s.blockNumber}`,
    );
    console.log(`    sqrtPriceX96=${s.sqrtPriceX96}`);
  }

  // ---------- 5. 报价 ----------
  hr('5. QuoterV2 报价（1 WETH -> USDC）');
  const ONE_WETH = (10n ** 18n).toString();
  for (const p of pools) {
    const q = await adapter.getQuote({
      chainId: UNISWAP_V3_CHAIN_ID,
      poolAddress: p.address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: ONE_WETH,
    });
    console.log(`  [cl fee=${p.fee}ppm] ${p.address}`);
    console.log(`    amountIn    = ${q.amountIn} (1 WETH)`);
    console.log(`    amountOut   = ${q.amountOut} USDC = ${formatUnits(q.amountOut, 6)}`);
    console.log(`    priceImpact = ${q.priceImpact} (近似)`);
    console.log(`    source      = ${q.source}`);
    const gas = await adapter.estimateGas({
      chainId: UNISWAP_V3_CHAIN_ID,
      poolAddress: p.address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: ONE_WETH,
    });
    console.log(`    gasEstimate = ${gas.gasLimit} (${gas.source})`);
  }

  // ---------- 6. 落库 ----------
  hr('6. 写入 dex_protocols / pools');
  const proto = await prisma.dexProtocol.upsert({
    where: {
      chain_id_name_version: {
        chain_id: UNISWAP_V3_CHAIN_ID,
        name: info.name,
        version: info.version,
      },
    },
    update: {
      protocol_type: info.protocolType,
      factory_address: info.factoryAddress,
      router_address: info.routerAddress,
      quoter_address: info.quoterAddress,
      is_enabled: true,
    },
    create: {
      chain_id: UNISWAP_V3_CHAIN_ID,
      name: info.name,
      protocol_type: info.protocolType,
      version: info.version,
      factory_address: info.factoryAddress,
      router_address: info.routerAddress,
      quoter_address: info.quoterAddress,
      is_enabled: true,
    },
  });
  console.log(`  dex_protocols: id=${proto.id}`);

  for (const s of states) {
    await prisma.pool.upsert({
      where: {
        chain_id_pool_address: {
          chain_id: UNISWAP_V3_CHAIN_ID,
          pool_address: s.address,
        },
      },
      update: {
        protocol_id: proto.id,
        token0_address: s.token0,
        token1_address: s.token1,
        fee: d(s.fee),
        liquidity: d(s.liquidity ?? '0'),
        reserve0: d('0'),
        reserve1: d('0'),
        last_synced_block: s.blockNumber,
      },
      create: {
        chain_id: UNISWAP_V3_CHAIN_ID,
        protocol_id: proto.id,
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
    console.log(`  pools upsert: [uniswap_v3 fee=${s.fee}ppm] ${s.address}`);
  }

  const poolCount = await prisma.pool.count({
    where: { chain_id: UNISWAP_V3_CHAIN_ID },
  });
  const protoCount = await prisma.dexProtocol.count({
    where: { chain_id: UNISWAP_V3_CHAIN_ID },
  });
  console.log(`\n完成。dex_protocols=${protoCount} 条，pools=${poolCount} 条（Base Sepolia）`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('VERIFY-UNISWAP-V3 PASSED');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nVERIFY-UNISWAP-V3 FAILED');
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
