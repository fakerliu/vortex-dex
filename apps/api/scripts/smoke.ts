/**
 * Sprint 1 冒烟测试：验证 10 张表可真实 CRUD、关系与唯一约束正确。
 *
 * 运行：pnpm --filter @vortex/api smoke  （= tsx scripts/smoke.ts）
 *
 * 注意：脚本使用「合成测试数据」（明显非真实地址/交易哈希），
 * 仅用于验证 ORM 读写；用后即清理，不污染 dev.db。
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// PostgreSQL 下金额字段为 Decimal @db.Decimal(78, 0)，统一用 Prisma.Decimal 构造
const d = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

let passed = 0;

function ok(name: string): void {
  passed += 1;
  console.log(`  \u2713 ${name}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

async function isUniqueViolation(err: unknown): Promise<boolean> {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

// 合成测试数据（明显非真实地址/交易哈希，仅用于冒烟测试）
const TEST = {
  wallet: '0x0000000000000000000000000000000000000001',
  chain: 8453,
  token0: '0x0000000000000000000000000000000000000100',
  token1: '0x0000000000000000000000000000000000000200',
  pool: '0x0000000000000000000000000000000000000300',
  factory: '0x0000000000000000000000000000000000000f00',
  txHash:
    '0xabababababababababababababababababababababababababababababababab',
};

async function cleanup(): Promise<void> {
  await prisma.swapEvent.deleteMany({
    where: { tx_hash: TEST.txHash },
  });
  await prisma.poolSnapshot.deleteMany({
    where: { pool: { pool_address: TEST.pool } },
  });
  await prisma.swap.deleteMany({ where: { tx_hash: TEST.txHash } });
  await prisma.routeCandidate.deleteMany({ where: { path_id: 'smoke-path-1' } });
  await prisma.quote.deleteMany({ where: { token_in: TEST.token0 } });
  await prisma.pool.deleteMany({ where: { pool_address: TEST.pool } });
  await prisma.dexProtocol.deleteMany({ where: { factory_address: TEST.factory } });
  await prisma.token.deleteMany({
    where: { address: { in: [TEST.token0, TEST.token1] } },
  });
  await prisma.analyticsDaily.deleteMany({ where: { date: '2099-01-01' } });
  await prisma.user.deleteMany({ where: { wallet_address: TEST.wallet } });
}

async function main(): Promise<void> {
  await cleanup(); // 幂等重跑：先清理残留测试数据

  try {
    // 1. users
    const user = await prisma.user.create({
      data: { wallet_address: TEST.wallet },
    });
    assert(user.wallet_address === TEST.wallet, 'user.wallet_address 未正确保存');
    ok('users create');

    // 2. tokens
    await prisma.token.create({
      data: {
        chain_id: TEST.chain,
        address: TEST.token0,
        symbol: 'TKN0',
        name: 'Test Token 0',
        decimals: 18,
        is_verified: true,
      },
    });
    await prisma.token.create({
      data: {
        chain_id: TEST.chain,
        address: TEST.token1,
        symbol: 'TKN1',
        name: 'Test Token 1',
        decimals: 6,
      },
    });
    ok('tokens create');

    // tokens 唯一约束 (chain_id + address)
    try {
      await prisma.token.create({
        data: {
          chain_id: TEST.chain,
          address: TEST.token0,
          symbol: 'DUP',
          name: 'Duplicate',
          decimals: 18,
        },
      });
      throw new Error('预期重复 token 应触发唯一约束');
    } catch (e) {
      if (await isUniqueViolation(e)) {
        ok('tokens 唯一约束 (chain_id+address) 生效');
      } else {
        throw e;
      }
    }

    // 3. dex_protocols
    const protocol = await prisma.dexProtocol.create({
      data: {
        name: 'SmokeTestDex',
        protocol_type: 'uniswap_v3',
        version: 'v1',
        chain_id: TEST.chain,
        factory_address: TEST.factory,
      },
    });
    ok('dex_protocols create');

    // 4. pools（含 FK -> dex_protocols）
    const pool = await prisma.pool.create({
      data: {
        chain_id: TEST.chain,
        protocol_id: protocol.id,
        token0_address: TEST.token0,
        token1_address: TEST.token1,
        fee: d('3000'),
        pool_address: TEST.pool,
        liquidity: d('1000000000000000000000'),
        reserve0: d('500000000000000000000'),
        reserve1: d('1000000000'),
        last_synced_block: 100,
      },
    });
    assert(pool.protocol_id === protocol.id, 'pool.protocol_id FK 未正确设置');
    ok('pools create (含 FK)');

    // 5. quotes
    await prisma.quote.create({
      data: {
        token_in: TEST.token0,
        token_out: TEST.token1,
        amount_in: d('1000000000000000000'),
        amount_out: d('5000000000'),
        gas_estimate: d('120000'),
        price_impact: d('0.05'), // 滑点 5%
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    ok('quotes create');

    // 6. route_candidates
    await prisma.routeCandidate.create({
      data: {
        path_id: 'smoke-path-1',
        token_path: JSON.stringify([TEST.token0, TEST.token1]),
        pool_path: JSON.stringify([TEST.pool]),
        protocol_path: JSON.stringify(['SmokeTestDex']),
        amount_in: d('1000000000000000000'),
        amount_out: d('5000000000'),
        estimated_gas: d('120000'),
        net_output: d('5000000000'),
        price_impact: d('0.05'),
        route_score: d('0.998'),
      },
    });
    ok('route_candidates create');

    // 7. swaps
    const swap = await prisma.swap.create({
      data: {
        user_address: TEST.wallet,
        token_in: TEST.token0,
        token_out: TEST.token1,
        amount_in: d('1000000000000000000'),
        amount_out: d('5000000000'),
        tx_hash: TEST.txHash,
        status: 'pending',
        chain_id: TEST.chain,
      },
    });
    assert(swap.tx_hash === TEST.txHash, 'swap.tx_hash 未正确保存');
    ok('swaps create');

    // swaps tx_hash 唯一约束
    try {
      await prisma.swap.create({
        data: {
          user_address: TEST.wallet,
          token_in: TEST.token0,
          token_out: TEST.token1,
          amount_in: d('1'),
          amount_out: d('2'),
          tx_hash: TEST.txHash,
          status: 'pending',
          chain_id: TEST.chain,
        },
      });
      throw new Error('预期重复 tx_hash 应触发唯一约束');
    } catch (e) {
      if (await isUniqueViolation(e)) {
        ok('swaps tx_hash 唯一约束生效');
      } else {
        throw e;
      }
    }

    // 8. swap_events（幂等写入：同一 tx 不同 log_index 可多条）
    const ev1 = await prisma.swapEvent.create({
      data: {
        swap_id: swap.id,
        tx_hash: TEST.txHash,
        event_type: 'Swap',
        block_number: 100,
        log_index: 0,
        event_data: JSON.stringify({ token_in: TEST.token0 }),
      },
    });
    const ev2 = await prisma.swapEvent.create({
      data: {
        swap_id: swap.id,
        tx_hash: TEST.txHash,
        event_type: 'Sync',
        block_number: 100,
        log_index: 1,
        event_data: JSON.stringify({ token_out: TEST.token1 }),
      },
    });
    assert(ev1.id !== ev2.id, '同一 tx 不同 log_index 应为两条记录');
    ok('swap_events create（同 tx 多 log 幂等）');

    // swap_events (tx_hash + log_index) 唯一约束
    try {
      await prisma.swapEvent.create({
        data: {
          swap_id: swap.id,
          tx_hash: TEST.txHash,
          event_type: 'Duplicate',
          block_number: 100,
          log_index: 0,
          event_data: '{}',
        },
      });
      throw new Error('预期重复 (tx_hash+log_index) 应触发唯一约束');
    } catch (e) {
      if (await isUniqueViolation(e)) {
        ok('swap_events 唯一约束 (tx_hash+log_index) 生效');
      } else {
        throw e;
      }
    }

    // 9. pool_snapshots（含 FK -> pools）
    const snap = await prisma.poolSnapshot.create({
      data: {
        pool_id: pool.id,
        block_number: 100,
        reserve0: d('500000000000000000000'),
        reserve1: d('1000000000'),
        liquidity: d('1000000000000000000000'),
      },
    });
    assert(snap.pool_id === pool.id, 'pool_snapshot.pool_id FK 未正确设置');
    ok('pool_snapshots create (含 FK)');

    // 10. analytics_daily
    const daily = await prisma.analyticsDaily.create({
      data: {
        date: '2099-01-01',
        chain_id: TEST.chain,
        volume_usd: d('123456'),
        swap_count: 7,
        unique_users: 3,
        platform_revenue_usd: d('123'),
        platform_cost_usd: d('45'),
      },
    });
    assert(daily.date === '2099-01-01', 'analytics_daily.date 未正确保存');
    ok('analytics_daily create');

    // ---- 读取验证（关系联查） ----
    const poolRead = await prisma.pool.findUnique({
      where: { id: pool.id },
      include: { protocol: true, snapshots: true },
    });
    assert(poolRead?.protocol.name === 'SmokeTestDex', 'pool -> protocol 关系读取失败');
    assert(poolRead?.snapshots.length === 1, 'pool -> snapshots 关系读取失败');
    ok('pools 关系读取（protocol + snapshots）');

    const swapRead = await prisma.swap.findUnique({
      where: { id: swap.id },
      include: { events: true },
    });
    assert(swapRead?.events.length === 2, 'swap -> events 关系读取失败');
    ok('swaps 关系读取（events）');

    console.log(`\nSMOKE TEST PASSED（${passed} 项检查通过）`);
  } finally {
    await cleanup();
    console.log('  cleanup done（测试数据已清理）');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nSMOKE TEST FAILED');
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
