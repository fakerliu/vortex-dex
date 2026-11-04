/**
 * Aerodrome 合约 ABI（仅保留 Adapter 用到的只读函数，最小化）。
 *
 * - classic Factory / Pool 接口对应 Velodrome v2 fork。
 * - CL Factory / Pool / Quoter 接口对应 Slipstream（Uniswap v3 fork）。
 *   注意：Aerodrome CL 用 tickSpacing（int24）代替 Uniswap v3 的 fee(uint24)
 *   作为池子维度；Quoter 的 quoteExactInputSingle 返回完整 QuoterV2 四元组。
 */

export const aerodromeClassicFactoryAbi = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'bool', name: 'stable', type: 'bool' },
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPoolsLength',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'allPools',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'pool', type: 'address' },
      { internalType: 'bool', name: 'stable', type: 'bool' },
    ],
    name: 'getFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const aerodromeClassicPoolAbi = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'stable',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint256', name: '_reserve0', type: 'uint256' },
      { internalType: 'uint256', name: '_reserve1', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address', name: 'tokenIn', type: 'address' },
    ],
    name: 'getAmountOut',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const aerodromeClFactoryAbi = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const aerodromeClPoolAbi = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint24', name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ internalType: 'int24', name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { internalType: 'int24', name: 'tick', type: 'int24' },
      { internalType: 'uint16', name: 'fee', type: 'uint16' },
      { internalType: 'uint16', name: 'observationIndex', type: 'uint16' },
      {
        internalType: 'uint16',
        name: 'observationCardinality',
        type: 'uint16',
      },
      { internalType: 'bool', name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Aerodrome classic Router 交易函数 ABI（仅 Swap 执行需要）。
 *
 * 关键差异（已链上核验，勿套 Uniswap V2）：
 * - classic 是 Velodrome v2 / Solidly 风格，路径参数是 `Route[]` 结构体数组，
 *   不是 Uniswap V2 的 `address[] path`。
 * - Route = { from, to, stable, factory }，其中 factory 传 classic PoolFactory。
 * - selector 已通过「抓取链上字节码 + 搜索 4 字节」核验：
 *   swapExactTokensForTokens = 0xcac88ea9（0x38ed1739 是 Uniswap V2 风格，链上不存在）。
 */
export const aerodromeClassicRouterAbi = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      {
        components: [
          { internalType: 'address', name: 'from', type: 'address' },
          { internalType: 'address', name: 'to', type: 'address' },
          { internalType: 'bool', name: 'stable', type: 'bool' },
          { internalType: 'address', name: 'factory', type: 'address' },
        ],
        internalType: 'struct IRouter.Route[]',
        name: 'routes',
        type: 'tuple[]',
      },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      {
        components: [
          { internalType: 'address', name: 'from', type: 'address' },
          { internalType: 'address', name: 'to', type: 'address' },
          { internalType: 'bool', name: 'stable', type: 'bool' },
          { internalType: 'address', name: 'factory', type: 'address' },
        ],
        internalType: 'struct IRouter.Route[]',
        name: 'routes',
        type: 'tuple[]',
      },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactETHForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      {
        components: [
          { internalType: 'address', name: 'from', type: 'address' },
          { internalType: 'address', name: 'to', type: 'address' },
          { internalType: 'bool', name: 'stable', type: 'bool' },
          { internalType: 'address', name: 'factory', type: 'address' },
        ],
        internalType: 'struct IRouter.Route[]',
        name: 'routes',
        type: 'tuple[]',
      },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactTokensForETH',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * Aerodrome Slipstream（CL，Uniswap v3 fork）SwapRouter 交易函数 ABI。
 *
 * 关键差异（已链上核验，勿套 Uniswap V3）：
 * - ExactInputSingleParams 第 3 个字段是 `int24 tickSpacing`，不是 Uniswap V3 的 `uint24 fee`。
 * - selector 已链上核验：exactInputSingle = 0xa026383e（0x414bf389 是 Uniswap V3 风格，链上不存在）。
 * - exactInput 的 bytes path 用 tickSpacing（3 字节）作为池维度编码（见 calldata.ts encodeClPath）。
 */
export const aerodromeSwapRouterAbi = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter.ExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'path', type: 'bytes' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
        ],
        internalType: 'struct ISwapRouter.ExactInputParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInput',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

/**
 * Aerodrome classic pool 事件 ABI（Sprint 7 Indexer 用，Velodrome v2 fork）。
 *
 * 事件签名已用 cast keccak 计算 topic0 并在 Base Mainnet 实抓日志核验：
 * - Swap(address,address,uint256,uint256,uint256,uint256) = 0xb3e27736…
 * - Sync(uint256,uint256)                                = 0xcf2aa508…
 * - Mint(address,uint256,uint256)                        = 0x4c209b5f…
 * - Burn(address,address,uint256,uint256)                = 0x5d624aa9…
 * - Fees(address,uint256,uint256)                        = 0x112c2569…（Aerodrome 特有）
 * 注意：Fees 是 Velodrome v2 风格池子特有事件，Uniswap V2 没有。
 */
export const aerodromeClassicPoolEventAbi = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: true, internalType: 'address', name: 'to', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount0In', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1In', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount0Out', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1Out', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Sync',
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'reserve0', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'reserve1', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Mint',
    inputs: [
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Burn',
    inputs: [
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: true, internalType: 'address', name: 'to', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Fees',
    inputs: [
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
  },
] as const;

/**
 * Aerodrome Slipstream（CL，Uniswap v3 fork）池子事件 ABI（Sprint 7 Indexer 用）。
 *
 * 事件签名已在 Base Mainnet 实抓日志核验：
 * - Swap(address,address,int256,int256,uint160,uint128,int24)       = 0xc42079f9…
 * - Mint(address,address,int24,int24,uint128,uint256,uint256)       = 0x7a53080b…
 * - Burn(address,int24,int24,uint128,uint256,uint256)               = 0x0c396cd9…
 * - Collect(address,address,int24,int24,uint128,uint128)            = 0x70935338…
 * 注意：CL 池没有 Sync 事件（价格/储备状态由 Swap 事件里的 sqrtPriceX96/tick/liquidity 携带）。
 */
export const aerodromeClPoolEventAbi = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: true, internalType: 'address', name: 'recipient', type: 'address' },
      { indexed: false, internalType: 'int256', name: 'amount0', type: 'int256' },
      { indexed: false, internalType: 'int256', name: 'amount1', type: 'int256' },
      { indexed: false, internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { indexed: false, internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { indexed: false, internalType: 'int24', name: 'tick', type: 'int24' },
    ],
  },
  {
    type: 'event',
    name: 'Mint',
    inputs: [
      { indexed: false, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: true, internalType: 'int24', name: 'tickLower', type: 'int24' },
      { indexed: true, internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { indexed: false, internalType: 'uint128', name: 'amount', type: 'uint128' },
      { indexed: false, internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Burn',
    inputs: [
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: true, internalType: 'int24', name: 'tickLower', type: 'int24' },
      { indexed: true, internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { indexed: false, internalType: 'uint128', name: 'amount', type: 'uint128' },
      { indexed: false, internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Collect',
    inputs: [
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: false, internalType: 'address', name: 'recipient', type: 'address' },
      { indexed: true, internalType: 'int24', name: 'tickLower', type: 'int24' },
      { indexed: true, internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { indexed: false, internalType: 'uint128', name: 'amount0', type: 'uint128' },
      { indexed: false, internalType: 'uint128', name: 'amount1', type: 'uint128' },
    ],
  },
] as const;

/** QuoterV2（quoteExactInputSingle 返回完整四元组，与 Uniswap v3 QuoterV2 一致）。 */
export const aerodromeQuoterAbi = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          {
            internalType: 'uint160',
            name: 'sqrtPriceLimitX96',
            type: 'uint160',
          },
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      {
        internalType: 'uint160',
        name: 'sqrtPriceX96After',
        type: 'uint160',
      },
      {
        internalType: 'uint32',
        name: 'initializedTicksCrossed',
        type: 'uint32',
      },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
