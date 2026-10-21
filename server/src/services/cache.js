'use strict';
/**
 * 数据版本号与计算缓存。
 *
 * 背景：computeAll 每次请求都 buildState（8 张表全量查询）+ 全量重算，
 * 而 /api/compute、/api/performance 等 10 个只读端点会各自重复这一过程。
 * 本模块为每个用户维护递增的数据版本号，只读计算结果按版本缓存复用；
 * 数据一旦变更，版本号 +1，旧缓存自然失效（key 不再命中）。
 *
 * 失效收口（三层）：
 * 1. 主收口：middleware/auth.js —— authRequired 验证通过后，非 GET 请求
 *    立即失效该用户缓存（前置失效，杜绝「写后读到旧值」的竞态）。
 *    /api/fx 前缀的写请求影响全局汇率表，失效全部用户。
 * 2. 定时任务：services/scheduler.js —— 每个 job 执行后 bumpAll
 *    （job 内部经 service 层写库，不经过 HTTP 层）。
 * 3. 直接写库场景（测试/脚本/迁移）：显式调用 bumpAll()。
 *
 * 兜底：所有缓存条目最长存活 TTL_MS，未知写路径的陈旧窗口有上限；
 * 环境变量 CALC_CACHE=off 可整体禁用（运维逃生口，等价于 v1.0.7 行为）。
 */

const enabled = process.env.CALC_CACHE !== 'off';
const TTL_MS = 120000;          // 兜底 TTL：缓存条目最长存活 2 分钟
const MAX_ENTRIES = 512;        // 防膨胀上限（超出即全清，命中率为优先级较低的问题）

/* 全局代际 gen（汇率等全局数据变更时 +1）+ 每用户版本 ver */
let gen = 0;
const ver = new Map();          // userId(number) -> version(number)
const store = new Map();        // cacheKey -> { value, at }

/** 当前生效版本串（构建缓存 key 用） */
function vOf(userId) {
  return `${gen}:${ver.get(userId) || 0}`;
}

function getCache(key) {
  if (!enabled) return undefined;
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) { store.delete(key); return undefined; }
  return entry.value;
}

function setCache(key, value) {
  if (!enabled) return value;
  if (store.size >= MAX_ENTRIES) store.clear();
  store.set(key, { value, at: Date.now() });
  return value;
}

/** 某用户数据已变更（事件/资产/账户/出入金/快照/定投/设置/行情同步等） */
function bumpUser(userId) {
  ver.set(userId, (ver.get(userId) || 0) + 1);
  if (store.size) {
    const prefix = `${vOf(userId)}|`;
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) store.delete(k);
    }
  }
}

/** 全局数据已变更（汇率表、定时任务、直接写库场景） */
function bumpAll() {
  gen += 1;
  store.clear();
}

module.exports = { vOf, getCache, setCache, bumpUser, bumpAll, enabled };
