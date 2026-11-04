# VORTEX DEX 文档

VORTEX DEX 是基于 Base 链的非托管 DEX Aggregator。Sprint 0-9 已全部完成交付。

## 文档索引

- [架构设计](architecture.md) — 系统分层（前端 → 后端 → DEX 适配器 → 链上合约），报价引擎、V2/V3 适配器、路由引擎、Gas 估算、路由优化、事件索引等模块说明。
- [API 文档](api.md) — 基于实际 controller 列出的全部 HTTP 接口（方法、路径、请求/响应字段）。
- [部署手册](deployment.md) — 本地 / 生产部署步骤（Docker、环境变量、数据库迁移、seed）。
- [Analytics 现状与缺口分析](analytics-gap-analysis.md) — Analytics & Diagnostic Center 开发基准：已有 / 缺失 / 可复用 / 需新增 / 关联缺口（intent_id 主线）。
- [Analytics 指标字典](metrics-dictionary.md) — 每个指标的公式、数据来源、统计口径、更新频率、钻取能力、完整性要求；标注「现有表 / 需新建表」。

## 其他参考

- 根目录 `README.md` — 项目简介、技术栈、目录结构、快速开始、已实现功能清单。
- `apps/web/README.md` — 前端技术栈与运行说明。
- `apps/api/README.md` — 后端目录说明。
- `contracts/README.md` — Foundry 合约项目（当前为占位）。
- `.env.example` — 全部环境变量清单。
