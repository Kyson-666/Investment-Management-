# 投资管家 · 个人投资资产管理系统

> 界面顶栏显示的版本号自动取自 `web/package.json` 的 `version`，随发版同步；
> 历史版本见 [Releases](https://github.com/hanyuestar/Investment-Management-/tags)。

[![License: MIT + Attribution](https://img.shields.io/badge/License-MIT%20%2B%20Attribution-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fhanyuestar%2Finvestment--management-blue?logo=docker)](https://github.com/hanyuestar/Investment-Management-/pkgs/container/investment-management)
[![Version](https://img.shields.io/badge/version-v1.0.0-green.svg)](https://github.com/hanyuestar/Investment-Management-/releases)

一个自托管的**个人多币种投资资产管理系统**：管理 A 股 / 美股 / 基金 / 理财 / 债券的账户、持仓、交易流水、定投、出入金，按发生日锁定汇率，服务端实时计算成本、盈亏、XIRR / TWR、资产配置、集中度、分红税与资本利得估算，并提供月末快照、基准对比、备份导入导出与多用户管理后台。

> 纯本地 / 私有部署，数据保存在你自己的 SQLite 数据库文件中。**所有税务、再平衡内容仅为辅助估算，不构成投资或税务建议。**

---

## 🖼 界面速览

> 全部截图由「数据管理 → 载入示例数据」生成，可一键复现（汇率 6.6954，持仓市值 ¥463,480.44）。红涨绿跌。

**核心能力**

| 总览 · 8 张 KPI + 持仓看板 + 类型分布 | 绩效 · XIRR / TWR / 基准 α 与月度对比 |
|---|---|
| ![总览](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-dashboard.png) | ![绩效](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-performance.png) |

| 配置 · 大类环形图 + 目标比例与再平衡建议 | 风险 · 持仓集中度 + 止盈止损预警 |
|---|---|
| ![配置](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-allocation.png) | ![风险](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-risk.png) |

**更多页面**

| 交易流水 · 买卖/分红/送股/拆分与锁定汇率 | 持仓 · 按类型筛选与关键词搜索 |
|---|---|
| ![交易流水](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-transactions.png) | ![持仓](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-holdings.png) |

| 税务 · 分红税分档与资本利得明细 | 收益报表 · 月度/年度已实现与含浮动 |
|---|---|
| ![税务](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-tax.png) | ![收益报表](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-reports.png) |

| 定投 · 按月计划与幂等批量生成 | 管理后台 · 用户 / 汇率 / SMTP |
|---|---|
| ![定投](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-dca.png) | ![管理后台](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/desktop-admin.png) |

**移动端适配**（≤768px 自动切换：抽屉导航 + 单列堆叠 + 宽表卡片化）

| 抽屉导航（汉堡按钮唤出，含账户视角切换） | 交易流水卡片化（字段与桌面表格一致） |
|---|---|
| ![移动端抽屉导航](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/mobile-drawer.png) | ![移动端交易流水](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@v1.0.0/screenshots/mobile-transactions.png) |

---

## 一、功能清单

| 模块 | 能力 |
|---|---|
| 总览 | 7 张核心 KPI（持仓市值、累计投入、累计收益、XIRR、TWR、基准 α、本年收益）、账户分布、持仓卡片 |
| 持仓 | 股票按现价×数量、非股票按持仓市值；卡片展示持仓成本、现价、汇率、浮动盈亏、分红、止盈止损线 |
| 账户 | 券商 / 银行 / 其他账户，CNY / USD 双币种，账户级市值、已实现、浮动与收益率汇总 |
| 交易流水 | 买入 / 卖出 / 现金分红 / 送股 / 拆分（股票）；申购 / 赎回 / 分红（非股票）；做 T 标记、手续费、备注、锁定汇率 |
| 绩效 | XIRR（资金加权，按天精确年化）、TWR（月末快照链式时间加权，证券子组合）、简单年化、累计收益率、基准 α、月度对比表与 ECharts 曲线 |
| 配置 | 大类资产环形图、境内/境外市场暴露、目标比例滑块、再平衡应调整金额、偏离度（Σ\|当前−目标\|/2）、账户分布 |
| 风险 | 第一大 / 前 5 大持仓集中度、股票类占比、止盈止损监控、预警阈值设置、站内预警 |
| 税务 | A 股分红按**各批次份额占比**分摊后，按批次持有期限定档（≤1 月 20%、1 月~1 年 10%、>1 年免征）、美股分红 30%、资本利得按 CNY/USD 资产 × 年度汇总（恒用移动加权平均口径） |
| 定投 | 基金 / 理财 / 债券按月定投计划，一键生成**今天及以前**的申购流水（未来期次由每日 00:10 任务生成），**幂等**（同资产同日自动跳过）；按发生日最近净值折算 |
| 现金流水 | 出入金（外部本金）、账户间内部划转（支持 CNY/USD 跨币种）、现金校准（对账差额）；划转/校准不计入组合投入，XIRR 外部现金流只认出金/入金与期初建仓本金 |
| 收益报表 | 月度已实现 / 证券净投入 / 月末持仓市值 / 含浮动收益，年度汇总；无快照月份不做插值 |
| 汇率 | 手动录入优先、自动同步兜底（Frankfurter 主源、open.er-api.com 备源、内置兜底 7.1）；每日 08:00 同步 |
| 数据管理 | 月末快照（按事件与净值历史派生对账）、基准点位录入、一键导出 / 导入 JSON 备份（导入前自动备份）、删除归档恢复、一键载入演示数据 |
| 账号体系 | 注册 / 登录、邮箱验证码登录（SMTP）、JWT 鉴权、按用户数据隔离、修改密码 |
| 管理后台 | 用户管理（禁用即时失效 / 重置临时密码）、汇率管理、SMTP 配置（密码 AES-256-GCM 加密、回显打码）、系统概览 |
| 部署 | 单容器 Docker / docker-compose；数据卷挂载；健康检查；每日 03:00 自动备份并清理过期备份 |

---

## 二、技术栈

**前端**（`web/`）：Vue 3（Composition API、`<script setup>`）· Vite 5 · Pinia 2 · Vue Router 4 · Element Plus 2 · ECharts 5 · Axios

**后端**（`server/`）：Node.js ≥ 20 · Express 4 · better-sqlite3（同步 SQLite，WAL 模式）· jsonwebtoken · bcryptjs · nodemailer · node-cron

**基础设施**：Docker / docker-compose（node:22-alpine 多阶段构建）；无外部数据库、无 Redis、无构建时网络依赖之外的服务。

---

## 三、目录结构

```
Investment Management/
├── README.md                  # 本文件
├── LICENSE                    # MIT License
├── LICENSE-ADDITIONAL.md      # 附加署名条款（使用者与 Fork 须保留原作者署名）+ 第三方组件 + 免责声明
├── Dockerfile                 # 多阶段：构建前端 → 后端运行，静态资源由 Express 托管
├── docker-compose.yml         # 一条命令起服务，挂载 ./data，含健康检查
├── .env.example               # 环境变量模板（端口/JWT/管理员/汇率源/SMTP/时区）
├── .gitignore / .dockerignore
├── data/                      # 运行时数据（SQLite、备份），已 gitignore，仅保留 .gitkeep
│   └── backups/               # 自动备份与导入前备份的 JSON
├── docs/                      # 项目 Wiki 源文件（★ 不提交到代码仓库，只推送到 GitHub Wiki，已 gitignore）
├── screenshots/               # README「界面速览」功能截图（演示数据生成，经调色板量化压缩）
├── design/                    # 设计交付包归档（规格文档、原型、参考引擎与测试，不参与运行）
├── server/                    # 后端
│   ├── package.json
│   ├── scripts/seed-demo.js   # 演示数据种子脚本
│   ├── src/
│   │   ├── server.js / app.js # 启动入口 / Express 装配
│   │   ├── config.js          # 全部环境变量与默认值
│   │   ├── db.js              # SQLite 连接、12 张表建表语句
│   │   ├── state.js           # 原始状态读写（按用户隔离）
│   │   ├── crypto.js          # AES-256-GCM 加解密（SMTP 密码）
│   │   ├── calc.js            # ★ 计算引擎（纯函数；口径唯一实现，改动须同步 design/server/calc.js 与测试）
│   │   ├── middleware/        # JWT 鉴权（每请求回查状态）、错误处理
│   │   ├── routes/            # 13 个路由模块（auth/accounts/assets/events/fx/...）
│   │   └── services/          # portfolio 派生计算、fx 双汇率源、mailer、backup、demoData、scheduler
│   └── test/                  # calc 115 断言 + API 54 用例 + regression 15 用例
└── web/                       # 前端
    ├── vite.config.js         # dev 5173 代理 /api → 8080；build 产物 dist/
    └── src/
        ├── main.js / App.vue
        ├── router/            # 17 个路由（含仅管理员可进的 /admin）
        ├── stores/            # Pinia：auth、portfolio（state + compute 单一数据源）
        ├── api/               # Axios 实例与各资源 API 封装
        ├── layout/            # 顶栏 + KPI 主布局
        ├── components/        # KPI 卡片、EChart 封装、资产卡片、8 类业务弹窗
        └── views/             # 17 个页面
```

---

## 四、快速开始（本地开发）

需要 Node.js ≥ 20（推荐 22）与 npm。

```bash
# 1) 后端
cd server
npm install
npm run seed:demo          # 可选：写入演示数据（3 账户 / 5 标的 / 13 流水 / 8 期快照基准）
npm start                  # 默认 http://localhost:8080
#    开发热更：npm run dev

# 2) 前端（另开一个终端）
cd web
npm install
npm run dev                # http://localhost:5173 ，/api 自动代理到 8080
```

生产形态下无需单独跑前端：`npm run build` 产物 `web/dist` 会被后端 Express 直接托管，访问 `http://localhost:8080` 即可。

### 默认账号（仅开发 / 演示）

| 用户名 | 密码 | 角色 | 说明 |
|---|---|---|---|
| `admin` | `admin12345` | 管理员 | 数据库中无管理员时首启自动创建，**生产环境务必修改** |
| `demo` | `demo1234` | 普通用户 | 执行 `seed:demo` 或页面“载入示例数据”后存在 |

详细步骤见 [`01 快速开始`](https://github.com/hanyuestar/Investment-Management-/wiki/01-快速开始)。

---

## 五、Docker 部署

**方式一：使用预构建镜像（推荐，无需本地构建）**

```bash
cp .env.example .env        # 修改 JWT_SECRET、CONFIG_SECRET、ADMIN_PASSWORD
docker compose pull         # 拉取 ghcr.io/hanyuestar/investment-management:latest
docker compose up -d
docker compose ps           # healthcheck 变为 healthy 后访问 http://localhost:8080
```

| 注册表 | 镜像 |
|---|---|
| GitHub Container Registry | `ghcr.io/hanyuestar/investment-management` |
| Docker Hub | `kyson666/investment-management` |

- 支持 **linux/amd64** 与 **linux/arm64**（x86 服务器与群晖 ARM 机型均可直接运行）；
- 版本 tag 形如 `v1.0.0`，`latest` 始终指向最新发布版；可用 `:v1.0.0` 锁定版本；
- 切换到 Docker Hub 源：`IMAGE=kyson666/investment-management:latest docker compose up -d`。

**方式二：本地构建**

```bash
cp .env.example .env
docker compose up -d --build
```

**通用说明**

- **生产环境必须把 `JWT_SECRET` 改为至少 32 位随机值**；仍使用默认/示例值时服务会拒绝启动（防止默认密钥部署）。
- 数据库与备份持久化在宿主机 `./data`；
- 容器内时区默认 `Asia/Shanghai`；
- 定时任务（汇率 / 定投 / 备份 / 预警 / 月末快照）在容器内运行；
- 升级时 `docker compose pull && docker compose up -d`（或重新 `build`）即可，SQLite 表使用 `CREATE TABLE IF NOT EXISTS`，数据不丢。

详见 [`02 Docker 部署`](https://github.com/hanyuestar/Investment-Management-/wiki/02-Docker部署)。

---

## 六、文档索引（Wiki）

| 文档 | 内容 |
|---|---|
| [01 快速开始](https://github.com/hanyuestar/Investment-Management-/wiki/01-快速开始) | 环境要求、本地开发、演示数据、默认账号、首启做什么 |
| [02 Docker 部署](https://github.com/hanyuestar/Investment-Management-/wiki/02-Docker部署) | 镜像构建、compose 配置、环境变量、数据卷与升级 |
| [03 API 手册](https://github.com/hanyuestar/Investment-Management-/wiki/03-API手册) | 鉴权方式与全部 REST 端点、请求/响应字段说明 |
| [04 计算口径与公式](https://github.com/hanyuestar/Investment-Management-/wiki/04-计算口径与公式) | 成本、双币种、XIRR/TWR、分红税、资本利得、配置/集中度口径 |
| [05 前端页面说明](https://github.com/hanyuestar/Investment-Management-/wiki/05-前端页面说明) | 17 个页面的用途、操作与数据来源 |
| [06 管理后台与鉴权](https://github.com/hanyuestar/Investment-Management-/wiki/06-管理后台与鉴权) | JWT 机制、角色权限、用户管理、SMTP 与验证码 |
| [07 备份与导入导出](https://github.com/hanyuestar/Investment-Management-/wiki/07-备份与导入导出) | JSON 备份格式、自动备份策略、迁移与恢复 |
| [08 FAQ](https://github.com/hanyuestar/Investment-Management-/wiki/08-FAQ) | 常见问题与排查 |
| [09 开发与测试](https://github.com/hanyuestar/Investment-Management-/wiki/09-开发与测试) | 代码约定、测试如何运行、演示数据验收数字 |

---

## 七、测试

```bash
cd server
npm test                   # = calc 115 断言 + api 54 用例 + regression 15 用例 + migrate/quotes
```

当前结果：**calc 115/115、api 54/54、migrate 2/2、quotes 6/6、regression 15/15 全通过**。前端无单元测试，验收方式为 `npm run build` 通过 + 浏览器逐页走查。

**移动端适配**：全站已做响应式（≤768px 单列堆叠 + 抽屉导航 + 触控友好尺寸，PC 布局与功能逻辑不变）。真机复核以 Chromium + CDP 完成 **4 视口 × 15 路由 = 60 组合**自动化：横向溢出 0、JS 报错 0、控制台 error 0。

演示数据的关键验收数字（汇率 6.6954）：

- 持仓市值 **¥463,480.44**（账户现金 ¥26,314.80 另行展示）；贵州茅台 **220 股**；第一大持仓集中度 **63.13%**
- 累计投入 **¥466,800.00**（净入金 + 期初建仓；演示数据无期初建仓）；已实现 **+¥10,404.80** / 浮动 **+¥12,590.44**
- 茅台 2026-06-30 分红 ¥300，持股 140 天落在 10% 档 → 分红税 **¥30**
- XIRR 校验场景：365 天前投 1000、当前 1100 → 年化 **10.00%**（独立场景）
- 演示组合 **TWR +19.60%** / **基准 α +3.02%**；XIRR **约 +6.70%**（截至 2026-10-20，按出入金 + 期初建仓现金流口径；该值随估值日变化）

---

## 八、已知限制

1. **Docker 镜像已通过 GitHub Actions 多架构（linux/amd64 + arm64）构建并发布**，但**未在本机以容器方式实跑**（本机无 Docker 环境）——容器编排/健康检查行为建议自行冒烟一次。
2. 前端无单元测试，靠构建 + 浏览器走查验收；响应式部分已补 CDP 真机自动化（4 视口 × 15 路由），仍**未在 iOS Safari / Android Chrome 真机实测**，触摸手势与软键盘行为未覆盖。
3. 行情价格不做自动抓取：股票现价、非股票持仓市值需手工维护（数据页/持仓卡片编辑）。
4. 税务模块为辅助估算，不覆盖所有减免情形，不构成申报依据。**注意：资本利得按移动加权平均口径计算，不随「成本核算方法」的 FIFO 设置变化**。
5. 单节点、单 SQLite 文件设计，面向个人单实例使用，不做高可用。

---

## 九、许可

本项目由 **hanyuestar 独立设计并开发**，现已开源，采用 **[MIT License](LICENSE) + [附加署名条款](LICENSE-ADDITIONAL.md)**。

| 项 | 说明 |
|---|---|
| 基础协议 | [MIT License](LICENSE)（允许自由使用、修改、分发、商用、再许可） |
| **附加条款** | [LICENSE-ADDITIONAL.md](LICENSE-ADDITIONAL.md) —— **使用者与 Fork／衍生分支必须完整保留原作者署名**，不得移除、遮盖、替换或伪造 |
| 修改后分发 | 须注明「基于 hanyuestar/Investment-Management- 修改」，并不得暗示为原作者官方版本 |
| 许可识别 | GitHub 侧边栏显示 MIT；附加条款与 MIT **同时生效**，其约束力强于 MIT 原文 |

**一句话**：随便用、随便改、可商用，**但请保留我的名字**。

### 第三方组件

使用了以下开源组件，著作权归各自作者，均按其自身许可授权（详见 [LICENSE-ADDITIONAL.md](LICENSE-ADDITIONAL.md) 第二节）：

- **MIT**：Vue 3、Vue Router、Pinia、Element Plus、@element-plus/icons-vue、Vite、Express、better-sqlite3、bcryptjs、jsonwebtoken
- **Apache-2.0**：ECharts ｜ **MIT-0**：nodemailer ｜ **ISC**：node-cron

### 免责声明

本软件按「原样」提供，不含任何担保。**税务估算、再平衡建议、绩效指标、预警等均为辅助计算，不构成投资、税务或财务建议**；行情与基准点位需手工维护。使用者应自行核对数据，并自行承担投资决策与申报结果。

### 合作与联系

- **合作意向 / 定制开发 / 商务授权 / 许可条款澄清**：hanyueppy@foxmail.com
- 问题反馈与功能建议：[GitHub Issues](https://github.com/hanyuestar/Investment-Management-/issues)

> 本项目允许自由使用与商用，唯一硬性要求是**保留原作者署名**。感谢尊重。

## 十、版本更新

> 面向使用者的更新说明。完整历史见 [Releases](https://github.com/hanyuestar/Investment-Management-/tags)。

### v1.0.9（2026-10-21）

> 视觉一致性与工程约定的维护性版本；**无口径变更、无数据结构变更**，功能行为与 v1.0.8 一致。

- **主题色单一来源**：新增 `utils/theme.js`，由 `styles/index.css` 的 CSS 变量统一取色（含兜底常量），图表调色板集中维护；替换总览 / 配置 / 绩效 / 风险 / 报表等页面的硬编码色值，消除主题色漂移。
- **徽章体系统一**：13 处 `el-tag` 全部替换为项目自有 `badge-*`（gray / ok / warn / danger），覆盖页面与组件，消除两套徽章体系造成的视觉与尺寸差异。
- **警示语义修正**：占比超阈值、配置偏离度此前用绿色（`.down` / `.neg`）表达“超标”，与红涨绿跌语义冲突且与同处占比条、徽章颜色自相矛盾；改为红色表示超标、橙黄表示轻度偏离，页面内配色自洽。
- **UI 复检**：17 页面 × 3 视口共 51 项检查，横向溢出 0、JS 错误 0、空白页 0。

### v1.0.8（2026-10-21）

> 快照自动化、计算性能优化与老库升级修复的补丁版本。**计算口径与 v1.0.7 完全一致**（`calc.js` 零改动，恒等式 `profit = mv + cash − margin − invest` 不变）。

- **快照自动回填**：数据页新增「回填缺失快照」——按「事件重放 + 净值历史」自动派生历史月末持仓市值并落库（`source=derived`）；已有快照（手工/自动/派生）一律跳过、绝不覆盖手填值；无持仓月不落 0 快照（避免破坏 TWR 区间）。缺净值历史、只能按当前价估算的月份照常落库并标记估算。
- **快照差异报告**：数据页新增「差异报告」——全月份「已存快照 vs 派生值」逐月对账；仅派生完整（无缺价、无估算）的月份计算差异，与保存前对比口径一致；汇总缺失 / 不一致 / 缺净值 / 最大差异率。
- **计算缓存**：引入数据版本号，状态构建与派生计算结果按版本缓存——总览 / 绩效 / 报表等 10 个只读端点共享一次状态构建（原先每请求全量查 8 张表并重算）；写请求前置失效杜绝「写后读到旧值」，另有 120 秒 TTL 兜底与 `CALC_CACHE=off` 运维开关。
- **事件分页**：流水列表 `GET /api/events` 支持可选 `limit/offset`（SQL 下推），缺省全量返回、完全向后兼容。
- **老库升级修复（重要）**：修复 v1.0.6–v1.0.7 遗留问题——`cash_flow` 缺划转列（`to_account_id` 等）的老库升级时，SCHEMA 建索引先于补列执行导致**服务启动崩溃**；改为在迁移补列之后创建该索引。老库现已可平滑升级。
- **移动端适配**：UI 一致性与移动端审计（17 页面 × 3 视口共 51 项检查，横向溢出 0、JS 错误 0）；修复差异报告表格在窄屏下列挤压导致金额折行、右侧列不可见的问题（改为固定列宽触发横向滚动 + 数值不折行）。
- **测试**：接口级用例 45 → 56（新增快照回填幂等 / 不覆盖手填 / 估算路径、差异报告、缓存写后读一致性、分页断言）；迁移用例 2 → 3（新增老库缺划转列的升级兼容用例）。

### v1.0.7（2026-10-20）

> 审计修复、口径统一、快照派生、删除归档与多币种现金账本的正式发布版本。

- **口径统一**：累计投入改为「净入金 + 期初建仓」；累计收益唯一口径；收益率分母 ≤ 0 时显示“—”。
- **XIRR**：期末值扣除融资，杠杆账户不再虚高。
- **时点**：所有计算支持 `asOf`，未来定投期次不再计入当前持仓。
- **写入校验**：超卖/超额赎回拒绝；账户有资产或流水后禁止改币种；编辑流水保留融资。
- **数据迁移**：示例数据与导入改为插入后重映射主键，第二个用户不再主键冲突。
- **报表**：快照断档月份累加区间净投入，申购不再被误算为浮动收益。
- **税务**：A 股分红税按批次份额分摊；资本利得覆盖卖出与赎回。
- **行情/定投**：非法代码逐个上报；新增净值历史，定投按发生日净值折算。
- **工程**：写操作审计、登录限流、验证码尝试上限、JWT 改密失效、生产默认密钥校验、本地日期统一。
- **快照**：按事件重放 + 净值历史派生月末市值，保存时给出差异提示，页面可“对比派生值”。
- **恢复**：删除账户/资产/流水/现金前自动归档，数据页可恢复或永久清理。
- **现金账本**：新增账户间内部划转（支持 CNY/USD 跨币种）与现金校准；两者不计入组合投入。
- **CI**：GitHub Actions 增加测试与前端构建门禁；`scripts/check-caliber.mjs` 阻止旧口径文档/页面回退。

### v1.0.6

**修复**

- 修正**美元账户全融资买入被误拒**的问题：融资校验时两笔金额没换算到同一币种
  （美元融资额 vs 美元成交金额的人民币数值），导致美元全融资永远报「融资超过总额」。
  现已按同一币种口径校验，美元全融资买入正常可用。
- 修正录入流水时「**你要自付**」显示巨额负数的问题（同一处换算方向错误）；
  现在总额、融资、自付均标注币种，一眼看清。
- 融资上限明确为「**成交金额 + 手续费**」：手续费也可以由融资覆盖（与记账引擎口径一致），
  「全融资买入」一笔到位。

**优化**

- 录入流水弹窗中「成交价」「分红金额」「金额」等字段的币种改为小字标注，
  不再因名称过长而换行。

### v1.0.5

**新增**

- **行情自动同步**：在资产里填写代码后，系统按**代码**自动获取最新单价——
  A股 / 美股每 15 分钟更新一次现价，基金每天 21:05 更新一次收盘后确认的净值。
  同步后自动重算盈亏与市值，**只更新价格，不动你的份额**。
- 持仓页新增「**同步行情**」按钮：随时手动获取最新价格（含手动维护过的价格）。
- 智能容错：主行情源不可用时自动切换备用源（股票 腾讯⇄新浪，基金 新浪⇄东财）；
  代码填错、查不到报价的标的会**逐个提示名称与代码**，方便核对修正。

**说明**

- 在资产编辑里手动改过价格 / 净值的标的，自动同步会**跳过**（保留你的手工值）；
  需要最新价时点「同步行情」即可强制刷新，刷新后恢复自动同步。
- 基金取的是收盘后**确认净值**（21:05 定时更新）；盘中估值暂不支持（免费估值源已下线）。
- 未填写代码的资产不参与同步，行为与旧版一致。

### v1.0.4

**修复**

- **存量数据自动修正**：旧版本录入的「期初建仓」若是非人民币资产（如美元），建仓汇率可能被
  错误记成 1:1，导致期初成本被低估。升级到本版后**首次启动自动按建仓日汇率重算**；
  导入旧备份文件时也会自动修正。仅修正错误的记录，正常数据一律不动，可放心升级。
- 修正**本年收益卡片的「浮动」显示「—」**的问题：不再依赖月末快照，录入持仓后即可显示。
- 修正**定投计划自动生成时缺份额**的问题（该缺陷会把定投本金全部显示为浮动亏损）。
- 修正顶栏版本号：自动显示真实版本（原先固定显示 v4.0）。

**优化**

- TWR 时间加权 / 基准 α 显示「—」时，给出需要补录的前置条件提示
  （需 ≥2 个月末快照；α 还需基准点位），不再让人猜。
- 内部质量改进（无界面变化）：汇率取值统一收敛、装载示例数据前的自动备份改为完整快照、
  删除确认弹窗统一、弹窗按需加载、无调用代码清理。

### v1.0.3

**修复**

- 修正「使用融资投资时，收益显示不正确」的问题。
  融资是向券商借来的钱、需要原样偿还，因此**不计入累计投入，也不计入收益**。
- 修正融资买入时账户现金显示不正确的问题：融资部分由券商直接付给卖方，不占用你的账户现金；
  卖出时所得金额优先偿还融资，剩余部分才回到现金。
- 新增校验与提示：**融资额不能超过成交金额**，录入时实时显示「你要自付多少」，
  避免把「自己掏的钱」误当成「成交总额」填写。
- 新增：**期初建仓的「成本单价」与「投入本金」支持人民币 / 美元切换录入**，
  按汇率自动换算，同币种时无需填写汇率。
- 修正：**美元（等非人民币）资产的期初成本被按 1:1 折算**的问题
  —— 原先建仓汇率被固定为 1，导致期初成本严重低估（如 5 美元 × 7.2 应记 36 元，实记 5 元）。
- 修正：**新增资产时的汇率取自接口最新值**，不再固定为 7.1。

**优化**

- **取消「总资产」这一概念**，首页与各页面统一以「**持仓市值**」展示持仓规模；
  账户现金与融资分别单独展示，不再合成一个容易混淆的合计数字。
- 同步修正全部页面说明与文档中的相关表述，使各处口径描述与计算结果完全一致。

### v1.0.2

**新增**

- **交易手续费**：股票、基金、理财、债券的买入 / 卖出 / 申购 / 赎回 / 分红，均可记录手续费（含税）。
  手续费按账户的交易币种填写（美股账户用美元、A 股等账户用人民币）；可填 0，不能为负。
  每个资产会累计显示「累计手续费」，方便随时掌握交易成本。
- **融资投资（仅券商账户）**：支持使用券商融资（借钱）进行投资。
  - 新建资产时可登记已经使用的融资，支持人民币 / 美元切换，自动换算。
  - 买入 / 申购时可登记本次使用的融资。
  - 卖出时所得金额会**优先偿还融资**，剩余部分才计入收益；融资需原样还给券商。
  - 账户列表新增「融资」列，一眼看出每个账户当前欠券商多少钱。
  - 使用融资的资产会同时显示「实际净值」与「自付本金」，收益一目了然。
- **收益可填负数**：分红、利息支持填写负数，用来记录融资产生的贷款利息等支出；
  同时支持人民币 / 美元录入，自动换算。

**修复**

- 修复备份数据「导出后再导入」会丢失部分信息的问题（持仓净值、融资、录入币种）。
- 修复每月末自动生成资产快照的功能未生效的问题。
- 修正资产数据提醒中的一处误导性建议 —— 原先按提示操作会使收益显示为负数。
- 各项数据提醒新增「不再提示」，并可在「设置」页随时恢复。

**优化**

- 安装包（Docker 镜像）体积进一步减小。

### v1.0.1

- **收益计算方式统一**：累计投入 = 净转入金额（转入 − 转出）；累计收益 = 已实现收益 + 浮动盈亏；
  累计收益 = 已实现 + 浮动。不再区分两种收益算法，看数更直观。
- 新增「**期初建仓**」：开始记账前就已持有的仓位，可直接登记当初的份额与成本，历史盈亏自动算清。
- 基金 / 理财 / 债券与股票统一按「**份额 + 单位价格**」记账，申购、赎回填写份额即可算出单位成本。
- 新增「**账户现金**」：转入 / 转出会计入账户现金与累计投入，并作为计算年化收益率的资金进出依据。
- 修正「只有期初建仓、没有转入记录」时年化收益率算错的问题。
- 资产当前价值支持「**按单价 / 按总市值**」两种录入方式，只知道总市值也能记。
- 出入金支持选择**录入币种**（人民币 / 美元），按汇率自动换算。
- 金额一律标注**具体货币名称**（人民币、美元等），不再使用含义不清的简称。
- 优化界面在手机上的显示效果，各项提醒更准确。

### v1.0.0

- 首个发布版本，包含：
  - 持仓成本自动核算、买入卖出与分红送股、
  - 收益表现分析（年化收益率、剔除资金进出后的真实收益、与大盘对比）、
  - 资产配置与再平衡、集中度提示与止盈止损提醒、
  - 分红税与卖出盈利的税费估算、月末资产快照与收益报表、
  - 定期投资计划、多币种支持、
  - 管理后台（用户 / 邮件 / 站点 / 统计）、全站适配手机。
