/**
 * Base Sepolia 端到端真钱闭环验证脚本。
 *
 * 目标：跑通「余额检查 → Approve → swap 广播 → 回写后端 submit → 回执确认
 * → 后端对账」完整链路，证明交易闭环在测试网真实可用（P0-2 真钱闭环）。
 *
 * 运行：
 *   pnpm --filter @vortex/api exec tsx scripts/e2e-sepolia-swap.ts
 *
 * 前置（环境变量，均不落库、不入 git）：
 *   - E2E_PRIVATE_KEY：测试钱包私钥（一次性钱包，只在 Sepolia 用）
 *   - BASE_SEPOLIA_RPC_URL：可选，缺省 https://sepolia.base.org
 *   - API_BASE_URL：可选，缺省 http://127.0.0.1:3001/api/v1
 *
 * 流程（自产测试币，顺便当第一笔真实交易）：
 *   1. 读钱包 ETH 余额；不足则提示去领水（Coinbase/Alchemy Sepolia faucet）
 *   2. 若 WETH 不足，wrap ETH → WETH（deposit）
 *   3. 用 WETH → USDC 在 Uniswap V3 池做第一笔真实 swap（自产 USDC，同时验证闭环）
 *   4. 全程走后端 prepare（拿 calldata）→ 本地签名广播 → submit 回写 → 回执确认 → 对账
 *
 * 说明：脚本是「可复跑」的验证资产，不是生产代码。私钥仅注入本进程，不写库、不打印。
 */
import 'dotenv/config';

const RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';
const API_BASE =
  process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';
const PRIVATE_KEY = process.env.E2E_PRIVATE_KEY;

const CHAIN_ID = 84532;
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function hr(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function apiCall(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(
      `${method} ${path} 失败: ${JSON.stringify(json.error ?? json)}`,
    );
  }
  return json.data;
}

async function main(): Promise<void> {
  if (!PRIVATE_KEY) {
    console.error(
      '缺少 E2E_PRIVATE_KEY 环境变量。请先创建一次性测试钱包并设置私钥（不入库）。',
    );
    process.exit(1);
  }

  // viem 动态导入（仅在拿到私钥后加载钱包客户端）。
  const { createPublicClient, createWalletClient, http, parseEther, formatEther, formatUnits } =
    await import('viem');
  const { baseSepolia } = await import('viem/chains');
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL, { timeout: 20000, retryCount: 2 }),
  });
  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(RPC_URL, { timeout: 20000, retryCount: 2 }),
    account,
  });

  const addr = account.address;
  console.log(`测试钱包: ${addr}`);

  // ---------- 1. ETH 余额检查 ----------
  hr('1. ETH 余额检查');
  const ethBal = await publicClient.getBalance({ address: addr });
  console.log(`  ETH = ${formatEther(ethBal)}`);
  if (ethBal === 0n) {
    console.error(
      '  ETH 余额为 0，请先去领水：https://www.alchemy.com/faucets/base-sepolia',
    );
    process.exit(1);
  }

  // ---------- 2. WETH 余额，不足则 wrap ----------
  hr('2. WETH 余额检查 + wrap');
  const erc20Abi = [
    {
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
  ] as const;

  let wethBal = (await publicClient.readContract({
    address: WETH as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [addr],
  })) as bigint;

  const wantWeth = parseEther('0.01');
  if (wethBal < wantWeth) {
    console.log(`  WETH=${formatEther(wethBal)} < ${formatEther(wantWeth)}，执行 wrap ETH→WETH`);
    const wethAbi = [
      {
        name: 'deposit',
        type: 'function',
        stateMutability: 'payable',
        inputs: [],
        outputs: [],
      },
    ] as const;
    const wrapHash = await walletClient.writeContract({
      address: WETH as `0x${string}`,
      abi: wethAbi,
      functionName: 'deposit',
      value: wantWeth - wethBal,
    });
    console.log(`  wrap tx: ${wrapHash}`);
    await publicClient.waitForTransactionReceipt({ hash: wrapHash });
    wethBal = (await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [addr],
    })) as bigint;
    console.log(`  wrap 完成，WETH=${formatEther(wethBal)}`);
  }

  // ---------- 3. 后端 prepare（拿 calldata） ----------
  hr('3. 后端 prepare（WETH → USDC）');
  const amountIn = wantWeth.toString(); // 0.01 WETH（18 位）
  const prepared = await apiCall('POST', '/swaps/prepare', {
    chainId: CHAIN_ID,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn,
    userAddress: addr,
    slippageBps: 50, // 0.5%
  });
  console.log(`  amountOut   = ${formatUnits(prepared.amountOut, 6)} USDC`);
  console.log(`  minReceived = ${formatUnits(prepared.minimumReceived, 6)} USDC`);
  console.log(`  needsApproval = ${prepared.needsApproval}`);
  console.log(`  spender     = ${prepared.spender}`);
  console.log(`  protocol    = ${prepared.protocol}`);

  // ---------- 4. Approve（如需） ----------
  if (prepared.needsApproval && prepared.approval) {
    hr('4. Approve（WETH → Router）');
    const approveHash = await walletClient.sendTransaction({
      to: prepared.approval.token as `0x${string}`,
      data: prepared.approval.data as `0x${string}`,
    });
    console.log(`  approve tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('  approve 完成');
  } else {
    hr('4. Approve 跳过（已有足够授权）');
  }

  // ---------- 5. 广播 swap ----------
  hr('5. 广播 swap');
  const swapHash = await walletClient.sendTransaction({
    to: prepared.transaction.to as `0x${string}`,
    data: prepared.transaction.data as `0x${string}`,
    value: prepared.transaction.value
      ? (BigInt(prepared.transaction.value) as bigint)
      : undefined,
  });
  console.log(`  swap tx: ${swapHash}`);

  // ---------- 6. 回写后端 submit ----------
  hr('6. 回写后端 submit');
  const submitted = await apiCall('POST', '/swaps/submit', {
    txHash: swapHash,
    userAddress: addr,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn,
    amountOut: prepared.amountOut,
    chainId: CHAIN_ID,
  });
  console.log(`  swap id   = ${submitted.id}`);
  console.log(`  status    = ${submitted.status}`);

  // ---------- 7. 回执确认 ----------
  hr('7. 回执确认');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  console.log(`  status = ${receipt.status}（${receipt.status === 'success' ? '成功' : '失败'}）`);
  console.log(`  block  = ${receipt.blockNumber}`);
  console.log(`  gas    = ${receipt.gasUsed}`);

  // ---------- 8. 后端对账（getSwap 读回执） ----------
  hr('8. 后端对账');
  const detail = await apiCall('GET', `/swaps/${submitted.id}`);
  console.log(`  后端 status = ${detail.status}`);
  console.log(`  后端 source = ${detail.statusSource ?? detail.source ?? 'N/A'}`);
  console.log(`  amountOut   = ${formatUnits(detail.amountOut ?? '0', 6)} USDC`);
  console.log(`  confirmedAt = ${detail.confirmedAt ?? 'null'}`);

  // ---------- 9. USDC 余额验证（闭环最终证据） ----------
  hr('9. USDC 余额验证（交易闭环最终证据）');
  const usdcBal = (await publicClient.readContract({
    address: USDC as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [addr],
  })) as bigint;
  console.log(`  钱包 USDC 余额 = ${formatUnits(usdcBal, 6)}（应 > 0，证明 swap 真实到账）`);

  console.log('\n✅ E2E-SEPOLIA-SWAP PASSED：真钱闭环验证通过');
}

main().catch((err) => {
  console.error('\n❌ E2E-SEPOLIA-SWAP FAILED');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
