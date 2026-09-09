'use strict';
const { randomUUID } = require('node:crypto');
const parse = value => JSON.parse(value || '{}');
function boundary(day, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('日期格式必须为 YYYY-MM-DD');
  const stamp = Date.parse(day + 'T00:00:00+08:00');
  if (!Number.isFinite(stamp) || new Date(stamp + 28800000).toISOString().slice(0, 10) !== day) throw new Error('日期无效');
  return new Date(stamp + (end ? 86400000 : 0)).toISOString();
}
function filters(input = {}, alias = 'c') {
  const args = [], clauses = ['1=1'];
  for (const key of ['organization_id', 'drama_id', 'user_id', 'account_id', 'model', 'source_kind', 'service_type', 'customer_kind', 'status', 'operation_id']) {
    if (input[key] == null || input[key] === '') continue;
    if (key.endsWith('_id') && key !== 'operation_id') {
      if (!Number.isSafeInteger(Number(input[key])) || Number(input[key]) < 0) throw new Error('筛选 ID 无效');
      if (Number(input[key]) === 0) { clauses.push(`${alias}.${key} IS NULL`); continue; }
    }
    clauses.push(`${alias}.${key}=?`); args.push(input[key]);
  }
  if (input.date_from) { clauses.push(`${alias}.submitted_at>=?`); args.push(boundary(input.date_from)); }
  if (input.date_to) { clauses.push(`${alias}.submitted_at<?`); args.push(boundary(input.date_to, true)); }
  if (input.date_from && input.date_to && input.date_from > input.date_to) throw new Error('开始日期不能晚于结束日期');
  if (input.cost_status) { clauses.push("COALESCE(r.cost_status,'processing')=?"); args.push(input.cost_status); }
  return { where: 'WHERE ' + clauses.join(' AND '), args };
}
const FROM = 'FROM cost_calls c LEFT JOIN cost_revisions r ON r.id=c.latest_revision_id';
const FIELDS = 'c.*,r.cost_status,r.amount_micro,r.currency,r.usage_json,r.price_id AS revision_price_id,r.observed_at AS revised_at';
function present(row) { return { ...row, usage: row.usage_json ? parse(row.usage_json) : null, context: parse(row.context_json), cost_status: row.cost_status || 'processing' }; }
function calls(db, input = {}) {
  const { where, args } = filters(input);
  const page = Math.max(1, Math.trunc(Number(input.page) || 1)), pageSize = Math.min(100, Math.max(1, Math.trunc(Number(input.page_size) || 20)));
  const total = db.prepare(`SELECT COUNT(*) n ${FROM} ${where}`).get(...args).n;
  const items = db.prepare(`SELECT ${FIELDS} ${FROM} ${where} ORDER BY c.submitted_at DESC,c.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize).map(present);
  return { items, total, page, page_size: pageSize };
}
const GROUPS = {
  customer: "COALESCE(CAST(c.organization_id AS TEXT),c.customer_kind)", project: "COALESCE(CAST(c.drama_id AS TEXT),'unknown')",
  user: "COALESCE(CAST(c.user_id AS TEXT),'unknown')", model: 'c.model', operation: 'c.source_kind',
  hour: "strftime('%Y-%m-%d %H:00',c.submitted_at,'+8 hours')", day: "strftime('%Y-%m-%d',c.submitted_at,'+8 hours')", month: "strftime('%Y-%m',c.submitted_at,'+8 hours')",
};
const METERS = ['input_token', 'cache_token', 'output_token', 'image', 'input_image', 'request', 'millisecond', 'character', 'second'];
function metricsSql() {
  return `COUNT(*) calls,SUM(CASE WHEN r.cost_status='calculated' THEN 1 ELSE 0 END) calculated_calls,
    SUM(CASE WHEN c.status='processing' THEN 1 ELSE 0 END) processing_calls,
    SUM(CASE WHEN r.cost_status='missing_usage' THEN 1 ELSE 0 END) missing_usage_calls,
    SUM(CASE WHEN r.cost_status='missing_price' THEN 1 ELSE 0 END) missing_price_calls,
    SUM(CASE WHEN r.cost_status IN ('unverified','calculation_error') THEN 1 ELSE 0 END) unverified_calls,
    SUM(CASE WHEN c.customer_kind='unknown' THEN 1 ELSE 0 END) unknown_customer_calls,
    SUM(CASE WHEN c.account_id IS NULL THEN 1 ELSE 0 END) unknown_account_calls,
    COALESCE(SUM(CASE WHEN r.cost_status='calculated' AND r.currency='CNY' THEN r.amount_micro ELSE 0 END),0) cny_micro,
    ${METERS.map(m => `COALESCE(SUM(json_extract(r.usage_json,'$.${m}')),0) ${m}`).join(',')},
    COALESCE(SUM(CASE WHEN c.service_type='video' THEN json_extract(r.usage_json,'$.output_token') ELSE 0 END),0) video_output_token`;
}
function summary(db, input = {}) {
  const { where, args } = filters(input);
  const totals = db.prepare(`SELECT ${metricsSql()} ${FROM} ${where}`).get(...args);
  totals.text_output_token = totals.output_token - totals.video_output_token;
  totals.total_tokens = totals.input_token + totals.cache_token + totals.output_token;
  totals.incomplete = totals.calls !== (totals.calculated_calls || 0);
  const currencies = db.prepare(`SELECT r.currency,SUM(r.amount_micro) amount_micro ${FROM} ${where} AND r.cost_status='calculated' GROUP BY r.currency`).all(...args);
  const coverage = db.prepare("SELECT value FROM cost_settings WHERE key='enabled_at'").get()?.value;
  let chargedWhere = 'WHERE 1=1', chargedArgs = [];
  for (const key of ['organization_id', 'drama_id', 'user_id']) {
    if (input[key] == null || input[key] === '') continue;
    if (Number(input[key]) === 0) chargedWhere += ` AND ${key} IS NULL`;
    else { chargedWhere += ` AND ${key}=?`; chargedArgs.push(Number(input[key])); }
  }
  if (input.date_from) { chargedWhere += ' AND created_at>=?'; chargedArgs.push(boundary(input.date_from)); }
  if (input.date_to) { chargedWhere += ' AND created_at<?'; chargedArgs.push(boundary(input.date_to, true)); }
  const charged = db.prepare(`SELECT COALESCE(SUM(charged_micro),0) amount FROM billing_usage_logs ${chargedWhere}`).get(...chargedArgs).amount;
  return { ...totals, currencies, coverage_start: coverage, generated_at: new Date().toISOString(), platform_points: input.customer_kind === 'unknown' ? null : charged / 10000,
    platform_points_scope: '客户、项目、用户与结算日期；不受供应商、模型和调用状态筛选影响',
    period_basis: 'supplier_submission', timezone: 'Asia/Shanghai', empty_message: totals.calls ? null : '当前记录范围内无调用' };
}
function breakdown(db, input = {}) {
  const group = GROUPS[input.group_by || 'customer']; if (!group) throw new Error('不支持的分组维度');
  const { where, args } = filters(input);
  const page = Math.max(1, Math.trunc(Number(input.page) || 1)), size = Math.min(100, Math.max(1, Math.trunc(Number(input.page_size) || 20)));
  const names = { customer: 'c.organization_name', project: 'c.project_title', user: 'c.user_name' };
  const label = names[input.group_by || 'customer'] || group;
  const total = db.prepare(`SELECT COUNT(*) n FROM (SELECT ${group} k ${FROM} ${where} GROUP BY k)`).get(...args).n;
  const items = db.prepare(`SELECT ${group} key,MAX(${label}) label,${metricsSql()} ${FROM} ${where} GROUP BY key ORDER BY cny_micro DESC,key LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  const money = items.length ? db.prepare(`SELECT ${group} key,r.currency,SUM(r.amount_micro) amount_micro ${FROM} ${where}
    AND r.cost_status='calculated' AND ${group} IN (${items.map(() => '?').join(',')}) GROUP BY key,r.currency`).all(...args, ...items.map(item => item.key)) : [];
  for (const item of items) item.currencies = money.filter(row => row.key === item.key).map(({ currency, amount_micro }) => ({ currency, amount_micro }));
  return { items, total, page, page_size: size };
}
function createReport(db, actor, input) {
  if (!/^\d{4}-\d{2}$/.test(input.month || '')) throw new Error('月份格式必须为 YYYY-MM');
  const from = input.month + '-01'; boundary(from);
  const last = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const organization = db.prepare('SELECT id,name FROM customer_organizations WHERE id=?').get(Number(input.organization_id));
  if (!organization) throw new Error('客户不存在');
  const query = { organization_id: organization.id, date_from: from, date_to: last };
  return db.transaction(() => {
    const id = randomUUID(), at = new Date().toISOString();
    const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM cost_reports WHERE organization_id=? AND month=?').get(organization.id, input.month).n;
    const result = { ...summary(db, query), filters: query, organization_name: organization.name, generated_at: at, label: '供应商成本估算' };
    db.prepare('INSERT INTO cost_reports VALUES(?,?,?,?,?,?,?)').run(id, organization.id, input.month, version, at, actor, JSON.stringify(result));
    const { where, args } = filters(query);
    const insert = db.prepare('INSERT INTO cost_report_items VALUES(?,?,?,?)');
    const read = db.prepare(`SELECT ${FIELDS} ${FROM} ${where} AND c.id>? ORDER BY c.id LIMIT 500`);
    let after = '';
    for (;;) {
      const rows = read.all(...args, after);
      if (!rows.length) break;
      for (const row of rows) insert.run(id, row.id, row.latest_revision_id, JSON.stringify(present(row)));
      after = rows.at(-1).id;
    }
    return report(db, id);
  })();
}
function report(db, id) { const row = db.prepare('SELECT * FROM cost_reports WHERE id=?').get(id); return row ? { ...row, summary: parse(row.summary_json) } : null; }
function csvCell(value) { let s = String(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function* reportCsvChunks(db, id, detail = false) {
  const r = report(db, id); if (!r) throw new Error('月报不存在');
  const line = values => values.map(csvCell).join(',') + '\r\n';
  if (r.summary.basis === 'billing_activity_v1') {
    yield '\uFEFF' + line(['客户', '月份', '版本', '保存时间（北京时间）', '口径']);
    yield line([r.summary.organization_name, r.month, r.version, chinaTime(r.generated_at), '原调用价格快照；已结算按结算日期，未结算按预授权日期；非实付账单']);
    yield line(['业务记录', '可复算记录', '模型计价折合（元）', '供应商费率估算（元）', '供应商费率覆盖记录', '原扣费含关联补扣（积分）']);
    yield line([r.summary.calls, r.summary.calculated_calls, r.summary.calculated_calls ? r.summary.model_amount_micro / 1e6 : '未确定', r.summary.supplier_priced_calls ? r.summary.supplier_amount_micro / 1e6 : '未确定', r.summary.supplier_priced_calls, r.summary.charged_micro / 10000]);
    if (detail) {
      yield line(['记录ID','项目','模型','时间（北京时间）','时间依据','状态','用量','模型计价折合（元）','供应商费率估算（元）','原扣费含补扣（积分）','差额（积分）','说明','价格快照']);
      let after = '';
      for (;;) {
        const items = db.prepare('SELECT call_id,detail_json FROM cost_report_items WHERE report_id=? AND call_id>? ORDER BY call_id LIMIT 500').all(id, after);
        if (!items.length) break;
        for (const item of items) {
          const c = parse(item.detail_json);
          yield line([c.id,c.project_title,c.model,chinaTime(c.occurred_at),c.time_basis,c.status,JSON.stringify(c.usage),c.model_amount_micro == null ? '未确定' : c.model_amount_micro / 1e6,c.supplier_amount_micro == null ? '未确定' : c.supplier_amount_micro / 1e6,c.charged_micro == null ? '未结算' : c.charged_micro / 10000,c.difference_micro == null ? '未确定' : c.difference_micro / 10000,c.reason,JSON.stringify(c.rates)]);
        }
        after = items.at(-1).call_id;
      }
    }
    return;
  }
  yield '\uFEFF' + line(['客户', '月份', '版本', '统计截止时间（北京时间）', '口径']);
  yield line([r.summary.organization_name, r.month, r.version, chinaTime(r.generated_at), '成本估算；非供应商实付账单']);
  if (!detail) {
    yield line(['币种', '估计费用']);
    for (const c of r.summary.currencies) yield line([c.currency, c.amount_micro / 1e6]);
    yield line(['指标', '数值']);
    const labels = { calls: '调用数', calculated_calls: '已计算', processing_calls: '未完成', missing_usage_calls: '缺用量', missing_price_calls: '缺价格或规格', unverified_calls: '待核实', unknown_customer_calls: '客户不明', unknown_account_calls: '供应商账号不明', input_token: '文本输入Token', cache_token: '缓存Token', text_output_token: '文本输出Token', video_output_token: '视频输出Token', image: '图片', input_image: '输入图片', millisecond: '处理毫秒', second: '秒', character: '字符', platform_points: '积分扣费（结算日期）' };
    for (const [key, label] of Object.entries(labels)) yield line([label, r.summary[key] || 0]);
    yield line(['自动记录起点（北京时间）', chinaTime(r.summary.coverage_start)]);
    yield line(['完整性', r.summary.incomplete ? '汇总尚不完整' : r.summary.calls ? '记录范围内已计算完整' : '当前记录范围内无调用']);
    yield line(['统计筛选', JSON.stringify(r.summary.filters)]);
  }
  else {
    yield line(['调用ID', '业务操作ID', '尝试', '项目', '用户', '模型', '提交时间（北京时间）', '时间依据', '状态', '成本状态', '用量', '币种', '估计费用', '证据版本', '价格版本', '供应商账号']);
    let after = '';
    for (;;) {
      const items = db.prepare('SELECT call_id,detail_json FROM cost_report_items WHERE report_id=? AND call_id>? ORDER BY call_id LIMIT 500').all(id, after);
      if (!items.length) break;
      for (const item of items) {
        const c = parse(item.detail_json);
        yield line([c.id, c.operation_id, c.attempt, c.project_title, c.user_name, c.model, chinaTime(c.submitted_at), c.time_basis, c.status, c.cost_status, JSON.stringify(c.usage), c.currency, c.amount_micro == null ? '未确定' : c.amount_micro / 1e6, c.latest_revision_id, c.revision_price_id, c.account_id]);
      }
      after = items.at(-1).call_id;
    }
  }
}
function reportCsv(db, id, detail = false) { return Array.from(reportCsvChunks(db, id, detail)).join(''); }
function chinaTime(at) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(at)); }
module.exports = { boundary, filters, calls, summary, breakdown, createReport, report, reportCsv, reportCsvChunks };
