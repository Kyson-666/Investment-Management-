#!/usr/bin/env node
/**
 * 口径文案门禁：防止页面/文档回退到已废弃的旧口径。
 * 运行：node scripts/check-caliber.mjs（CI 与 npm test 都会跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  'web/src',
  'README.md',
  'docs/03-API手册.md',
  'docs/04-计算口径与公式.md',
  'docs/05-前端页面说明.md',
  'docs/08-FAQ.md',
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '_local', 'backups']);

const RULES = [
  {
    re: /累计投入\s*=\s*净入金(?![^\n]*期初建仓)/g,
    msg: '累计投入不能只写净入金，应为「净入金 + 期初建仓」',
  },
  {
    re: /累计投入只按净入金/g,
    msg: '累计投入已包含期初建仓，不能写“只按净入金”',
  },
  {
    re: /当月净投入/g,
    msg: '快照断档已按区间累加，不能写“当月净投入”',
  },
  {
    re: /不依赖月末快照/g,
    msg: '本年收益依赖上年末快照/退化规则，不能写“不依赖月末快照”',
  },
  {
    re: /价格预警数(?!组)/g,
    msg: '预警已包含持仓浮盈率，不能写“价格预警数”',
  },
  {
    re: /总资产/g,
    msg: '产品已取消“总资产”概念，应使用“持仓市值”',
    allow: /取消|不再|历史|废弃/,
  },
];

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(p))) return;
    for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
    return;
  }
  if (/\.(vue|md)$/.test(p)) out.push(p);
}

const files = [];
for (const t of TARGETS) {
  const p = path.join(ROOT, t);
  if (fs.existsSync(p)) walk(p, files);
}

const hits = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.allow && rule.allow.test(line)) continue;
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) {
        hits.push(`${path.relative(ROOT, file)}:${i + 1}  ${rule.msg}\n    ${line.trim()}`);
      }
    }
  });
}

if (hits.length) {
  console.error(`❌ 口径门禁失败：发现 ${hits.length} 处旧口径\n`);
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`✅ 口径门禁通过：扫描 ${files.length} 个文件，无旧口径表述`);
