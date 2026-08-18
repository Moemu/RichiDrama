const operations = require('./adminOperationsService');

function shanghaiDate(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function recordDailyReport(db, at = new Date()) {
  const summary = operations.overview(db, {});
  const reportDate = shanghaiDate(at);
  db.prepare(`INSERT INTO operations_report_snapshots (report_date, generated_at, summary_json) VALUES (?, ?, ?)
    ON CONFLICT(report_date) DO UPDATE SET generated_at=excluded.generated_at, summary_json=excluded.summary_json`)
    .run(reportDate, at.toISOString(), JSON.stringify(summary));
  return { report_date: reportDate, generated_at: at.toISOString(), summary };
}

function listReports(db, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size, 10) || 20));
  const total = Number(db.prepare('SELECT COUNT(*) count FROM operations_report_snapshots').get().count || 0);
  const rows = db.prepare('SELECT * FROM operations_report_snapshots ORDER BY report_date DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  return { items: rows.map((row) => ({ ...row, summary: JSON.parse(row.summary_json) })), total, page, page_size: pageSize };
}

function startDailyReporting(db, log, options = {}) {
  const run = () => {
    try { return recordDailyReport(db); }
    catch (error) { log?.warn?.('operations daily report failed', { error: error.message }); return null; }
  };
  if (options.immediate !== false) run();
  const intervalMs = Number(options.interval_ms || 24 * 60 * 60 * 1000);
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { runNow: run, stop: () => clearInterval(timer) };
}

module.exports = { shanghaiDate, recordDailyReport, listReports, startDailyReporting };
