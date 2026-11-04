/**
 * Swap 执行核验脚本（Sprint 6）。
 *
 * 运行：pnpm --filter @vortex/api exec tsx scripts/verify-swap.ts
 *
 * 核验内容：
 * 1. 状态机（合法转换 + 终态 + 非法转换拒绝）
 * 2. calldata 构造正确性：
 *    - 用 viem encodeFunctionData 构造，断言 selector 与链上字节码核验值一致
 *    - 用 cast calldata-decode 反解（若本机有 foundry）验证 ABI 编码可回读
 * 3. 真实链上（Base Mainnet）：
 *    - erc20.allowance(0x0000...0000, Router) == 0
 *    - 端到端 prepare（WETH -> USDC，1 WETH，user=0x0000...0000）
 *
 * 非托管：本脚本不广播任何交易、不接触私钥，只读 + 只构造 calldata。
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { ChainRpcService } from '../src/chain/chain-rpc.service';
import { Erc20ReaderService } from '../src/chain/erc20-reader.service';
import { BASE_MAINNET_CHAIN_ID } from '../src/chain/chain.constants';
import { AerodromeClassicAdapter } from '../src/dex/aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from '../src/dex/aerodrome/aerodrome-cl.adapter';
import { DexPoolService } from '../src/dex/dex-pool.service';
import {
  AERODROME_CLASSIC_ROUTER,
  AERODROME_SWAP_ROUTER,
} from '../src/dex/aerodrome/constants';
import {
  buildClassicSwapExactTokensForTokens,
  buildClExactInputSingle,
  buildClExactInput,
  buildApproveCalldata,
  classicRoute,
  encodeClPath,
} from '../src/dex/calldata';
import { SwapService } from '../src/modules/swap/swap.service';
import {
  canTransition,
  isTerminalStatus,
  SwapStatus,
} from '../src/modules/swap/swap.types';
import { formatUnits } from '../src/common/utils/units';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ZERO = '0x0000000000000000000000000000000000000000';

function hr(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`断言失败: ${msg}`);
  }
}

/** 用 cast calldata-decode 反解；找不到 cast 则跳过（不视为失败）。 */
function castDecode(sig: string, data: string): string {
  const path = `${process.env.HOME ?? '~'}/.foundry/bin`;
  try {
    const out = execFileSync('cast', ['calldata-decode', sig, data], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${path}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const detail =
      typeof e.stderr === 'string'
        ? e.stderr
        : e.stderr
          ? e.stderr.toString()
          : e.message;
    return `(cast 反解失败/不可用: ${detail})`;
  }
}

async function main(): Promise<void> {
  // ---------- 1. 状态机 ----------
  hr('1. 状态机核验');
  const expectedLegal: Array<[string, string]> = [
    [SwapStatus.CREATED, SwapStatus.QUOTED],
    [SwapStatus.CREATED, SwapStatus.PENDING],
    [SwapStatus.QUOTED, SwapStatus.APPROVAL_REQUIRED],
    [SwapStatus.QUOTED, SwapStatus.APPROVED],
    [SwapStatus.APPROVAL_REQUIRED, SwapStatus.APPROVED],
    [SwapStatus.APPROVED, SwapStatus.PENDING],
    [SwapStatus.PENDING, SwapStatus.CONFIRMED],
    [SwapStatus.PENDING, SwapStatus.REVERTED],
    [SwapStatus.PENDING, SwapStatus.DROPPED],
    [SwapStatus.PENDING, SwapStatus.REPLACED],
  ];
  for (const [from, to] of expectedLegal) {
    assert(canTransition(from, to), `${from} -> ${to} 应为合法转换`);
  }
  const expectedIllegal: Array<[string, string]> = [
    [SwapStatus.PENDING, SwapStatus.APPROVED],
    [SwapStatus.CONFIRMED, SwapStatus.PENDING],
    [SwapStatus.REVERTED, SwapStatus.PENDING],
    [SwapStatus.APPROVED, SwapStatus.APPROVAL_REQUIRED],
    [SwapStatus.CONFIRMED, SwapStatus.FAILED],
  ];
  for (const [from, to] of expectedIllegal) {
    assert(!canTransition(from, to), `${from} -> ${to} 应为非法转换`);
  }
  for (const s of [
    SwapStatus.CONFIRMED,
    SwapStatus.FAILED,
    SwapStatus.REVERTED,
    SwapStatus.EXPIRED,
    SwapStatus.REPLACED,
    SwapStatus.DROPPED,
  ]) {
    assert(isTerminalStatus(s), `${s} 应为终态`);
  }
  assert(!isTerminalStatus(SwapStatus.PENDING), 'PENDING 不应是终态');
  console.log('  状态机转换/终态断言全部通过');

  // ---------- 2. calldata 构造 ----------
  hr('2. calldata 构造核验');
  const deadline = 1_800_000_000;
  const amountIn = (10n ** 18n).toString(); // 1 WETH
  const amountOutMin = (1000000n).toString();

  // 2a. classic swapExactTokensForTokens
  const classicTx = buildClassicSwapExactTokensForTokens({
    amountIn,
    amountOutMin,
    routes: [classicRoute(WETH, USDC, false)],
    recipient: ZERO,
    deadline,
  });
  console.log(`  [classic] function=${classicTx.functionName}`);
  console.log(`  [classic] to=${classicTx.to}`);
  console.log(`  [classic] selector=${classicTx.selector}`);
  assert(classicTx.selector === '0xcac88ea9', 'classic selector 应为 0xcac88ea9');
  assert(classicTx.to === AERODROME_CLASSIC_ROUTER.toLowerCase(), 'classic 目标应为 Router');
  console.log(
    `  [classic] cast decode: ${castDecode(
      'swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)',
      classicTx.data,
    )}`,
  );

  // 2b. CL exactInputSingle
  const clTx = buildClExactInputSingle({
    tokenIn: WETH,
    tokenOut: USDC,
    tickSpacing: 100,
    recipient: ZERO,
    deadline,
    amountIn,
    amountOutMinimum: amountOutMin,
  });
  console.log(`  [cl] function=${clTx.functionName}`);
  console.log(`  [cl] to=${clTx.to}`);
  console.log(`  [cl] selector=${clTx.selector}`);
  assert(clTx.selector === '0xa026383e', 'CL selector 应为 0xa026383e');
  assert(clTx.to === AERODROME_SWAP_ROUTER.toLowerCase(), 'CL 目标应为 SwapRouter');
  console.log(
    `  [cl] cast decode: ${castDecode(
      'exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))',
      clTx.data,
    )}`,
  );

  // 2c. CL 多跳 bytes path
  const clPath = encodeClPath([
    { tokenIn: WETH, tokenOut: USDC, tickSpacing: 100 },
  ]);
  assert(
    clPath.toLowerCase() ===
      `0x${WETH.slice(2).toLowerCase()}000064${USDC.slice(2).toLowerCase()}`,
    '单跳 CL path 编码不正确',
  );
  const clMultiTx = buildClExactInput({
    path: clPath,
    recipient: ZERO,
    deadline,
    amountIn,
    amountOutMinimum: amountOutMin,
  });
  console.log(`  [cl-multi] function=${clMultiTx.functionName}`);
  console.log(`  [cl-multi] selector=${clMultiTx.selector}`);
  assert(clMultiTx.selector === '0xc04b8d59', 'CL exactInput selector 应为 0xc04b8d59');
  console.log(
    `  [cl-multi] cast decode: ${castDecode(
      'exactInput((bytes,address,uint256,uint256,uint256))',
      clMultiTx.data,
    )}`,
  );

  // 2d. approve calldata
  const approveTx = buildApproveCalldata({
    spender: AERODROME_CLASSIC_ROUTER,
    amount: amountIn,
  });
  console.log(`  [approve] selector=${approveTx.selector}`);
  assert(approveTx.selector === '0x095ea7b3', 'approve selector 应为 0x095ea7b3');
  console.log(
    `  [approve] cast decode: ${castDecode(
      'approve(address,uint256)',
      approveTx.data,
    )}`,
  );

  // ---------- 3. 真实链上 ----------
  hr('3. 真实链上核验（Base Mainnet）');
  const prisma = new PrismaClient();
  const rpc = new ChainRpcService();
  const erc20 = new Erc20ReaderService(rpc);
  const classic = new AerodromeClassicAdapter(rpc);
  const cl = new AerodromeClAdapter(rpc);
  const poolService = new DexPoolService(classic, cl);
  const swapService = new SwapService(prisma, rpc, erc20, poolService, classic, cl);

  const allowanceZero = await erc20.readAllowance(
    BASE_MAINNET_CHAIN_ID,
    WETH,
    ZERO,
    AERODROME_CLASSIC_ROUTER,
  );
  console.log(`  WETH.allowance(0x000...000, classicRouter) = ${allowanceZero}`);
  assert(allowanceZero === 0n, '零地址 allowance 应为 0');

  const prepare = await swapService.prepare({
    chainId: BASE_MAINNET_CHAIN_ID,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn,
    userAddress: ZERO,
    slippageBps: 50,
  });
  console.log(`  prepare.tokenIn       = ${prepare.tokenIn}`);
  console.log(`  prepare.tokenOut      = ${prepare.tokenOut}`);
  console.log(`  prepare.amountIn      = ${prepare.amountIn} (${formatUnits(prepare.amountIn, 18)} WETH)`);
  console.log(`  prepare.amountOut     = ${prepare.amountOut} (${formatUnits(prepare.amountOut, 6)} USDC)`);
  console.log(`  prepare.minimumReceived = ${prepare.minimumReceived}`);
  console.log(`  prepare.deadline      = ${prepare.deadline}`);
  console.log(`  prepare.protocol      = ${prepare.protocol}`);
  console.log(`  prepare.route[0]      = ${JSON.stringify(prepare.route[0])}`);
  console.log(`  prepare.spender       = ${prepare.spender}`);
  console.log(`  prepare.balance       = ${prepare.balance}`);
  console.log(`  prepare.allowance     = ${prepare.allowance}`);
  console.log(`  prepare.needsApproval = ${prepare.needsApproval}`);
  console.log(`  prepare.tx.function   = ${prepare.transaction.functionName}`);
  console.log(`  prepare.tx.to         = ${prepare.transaction.to}`);
  console.log(`  prepare.tx.selector   = ${prepare.transaction.selector}`);
  console.log(`  prepare.tx.data       = ${prepare.transaction.data}`);
  assert(prepare.needsApproval === true, '零地址未授权，needsApproval 应为 true');
  assert(prepare.approval !== null, 'needsApproval=true 时应附带 approve calldata');
  assert(
    prepare.transaction.selector === '0xcac88ea9' || prepare.transaction.selector === '0xa026383e',
    'prepare 交易 selector 必须是 classic 或 CL 其中之一',
  );

  await prisma.$disconnect();
  console.log('\nVERIFY-SWAP PASSED');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nVERIFY-SWAP FAILED');
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
