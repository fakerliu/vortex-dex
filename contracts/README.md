# contracts — Foundry 合约项目（占位）

VORTEX DEX 智能合约使用 [Foundry](https://book.getfoundry.sh/) 管理。

## 目录结构

```
contracts/
├── foundry.toml   # Foundry 配置模板
├── src/           # 合约源码（.sol）
├── script/        # 部署 / 交互脚本（.s.sol）
└── test/          # 合约测试（.t.sol）
```

## 前置条件

本机当前**未安装 Foundry（forge）**。安装方式（Linux/macOS/WSL）：

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Windows 原生环境建议在 WSL 中安装，或参考 Foundry 官方文档的 Windows 支持说明。

安装后校验：

```bash
forge --version
```

## 初始化（forge 安装后执行）

```bash
# 若已存在本目录结构，可跳过 init，直接补依赖：
forge init --no-git --force
forge install foundry-rs/forge-std
```

## 编译 / 测试 / 部署

```bash
forge build            # 编译
forge test             # 测试
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

## 安全说明

- 部署私钥（`DEPLOYER_PRIVATE_KEY`）、验证密钥（`ETHERSCAN_API_KEY`）必须经环境变量 / 密钥管理注入，禁止提交到仓库。
- `contracts/out/`、`cache/`、`broadcast/`、`lib/` 已加入 `.gitignore`。
- 合约地址以部署后广播（broadcast）产物与区块浏览器为准，勿在仓库中硬编码真实地址。
