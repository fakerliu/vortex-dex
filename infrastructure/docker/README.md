# infrastructure/docker

容器化配置目录（面向部署）。

- 本地开发用 `docker-compose.yml` 位于仓库根目录，仅起 PostgreSQL + Redis。
- 本目录后续放置各服务（web / api / data-layer）的生产/预发 Dockerfile 与多阶段构建模板。
- 本机当前未安装 Docker，相关配置为模板，待环境具备后再执行构建与运行。
