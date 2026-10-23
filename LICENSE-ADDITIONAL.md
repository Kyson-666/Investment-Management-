# 附加条款（Additional Terms）

> 本文件是本项目许可协议的组成部分，与 [`LICENSE`](LICENSE)（MIT License）**同时生效**。
> 附加条款的约束力**强于 MIT 原文**：MIT 本身仅要求保留版权与许可声明，本文件进一步要求**保留原作者署名**并与项目关联。
> 若你需要法律上严格 OSI 认可的纯 MIT 授权（不含以下附加条款），请来信协商取得书面许可。

- **项目**：投资管家 · 个人投资资产管理系统（Investment Management）
- **作者**：hanyuestar —— 独立设计并开发
- **仓库**：https://github.com/Kyson-666/Investment-Management-
- **联系**：hanyueppy@foxmail.com（有合作意向欢迎来信）

---

## 一、附加署名条款（Additional Attribution Requirement）

**1. 必须保留原作者署名。**
任何个人或组织在使用、复制、修改、合并、发布、分发、再许可或销售本项目及其衍生作品时（包括但不限于 **Fork、二次开发、重新打包、Docker 镜像再分发、私有部署，以及以 SaaS / 托管方式对外提供服务**），均须完整保留：

- [`LICENSE`](LICENSE) 与本文件；
- 源代码及产物中全部版权声明与作者署名；
- README 中「作者 / 项目来源 / 仓库地址」相关信息。

**2. 不得移除、遮盖、替换或伪造署名。**
包括但不限于：把版权信息改成自己或第三方、删除作者栏、以任何明示或暗示的方式让使用者误认为本项目由你（或他人）独立开发。

**3. 修改后再分发须注明来源。**
若分发的是修改后的版本（含 Fork 与派生项目），应在 README 或其它显著位置注明：

> 本项目基于 [Kyson-666/Investment-Management-](https://github.com/Kyson-666/Investment-Management-) 修改

并简要说明主要修改内容。修改版本不得暗示为原作者官方版本。

**4. 项目名称与作者身份不得被冒用。**
不得以本项目作者名义进行宣传、背书、招商或承担责任。

**5. 商业使用无需事先授权**（MIT 允许），但须逐条满足上述 1–4 条；如需作者提供官方支持、定制开发或商务合作，请通过文首联系方式沟通。

---

## 二、第三方组件声明

本项目使用了若干开源组件，其著作权归各自作者所有，并依其自身许可协议（均为宽松型许可）授权使用：

| 组件 | 许可 |
|---|---|
| Vue 3 · Vue Router · Pinia | MIT |
| Element Plus · @element-plus/icons-vue | MIT |
| ECharts | **Apache-2.0** |
| Vite · @vitejs/plugin-vue | MIT |
| Express | MIT |
| better-sqlite3 | MIT |
| bcryptjs | MIT |
| jsonwebtoken | MIT |
| nodemailer | MIT-0 |
| node-cron | ISC |

完整依赖树与版本号见 `server/package-lock.json`、`web/package-lock.json`。二次分发时请一并保留这些组件的许可声明。

---

## 三、免责声明

本项目为个人自用的投资记账与分析工具，按「原样」提供，不附带任何明示或默示担保。

- 软件内的**税务估算、再平衡建议、绩效指标、预警**等均为辅助计算，**不构成投资、税务、法律或财务建议**；
- 行情价格、基准点位需**手工维护**，不由本软件自动抓取或保证准确性；
- 使用者应自行核对数据，并对自身的投资决策与申报结果负责；
- 因使用本软件产生的任何直接或间接损失，作者不承担责任。

---

## 四、合作与联系

- **合作意向 / 定制开发 / 商务授权 / 许可条款澄清**：hanyueppy@foxmail.com
- 问题反馈与功能建议：[GitHub Issues](https://github.com/Kyson-666/Investment-Management-/issues)

> 使用者与 Fork 分支**必须保留原作者署名** —— 这是本项目开源的前提，感谢尊重。
