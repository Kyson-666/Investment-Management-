'use strict';
/** 本地日期工具：统一用服务器本地时区，禁止 toISOString().slice(0,10)（东八区凌晨会退回前一天） */
function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localMonth(d = new Date()) {
  return localDate(d).slice(0, 7);
}
module.exports = { localDate, localMonth };
