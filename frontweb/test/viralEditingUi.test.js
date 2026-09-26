import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { moveViralEpisode, viralGradeChips, viralRatingText, viralTimelineSegments, viralBillingText, viralDurationText, viralModeName, viralStatusName, viralFinalsOnly, viralSortedAssets, viralEpisodeOrder, viralPickerAssets, viralTruncationHint } from '../src/utils/viralEditing.js'

const component = () => readFile(new URL('../src/components/ViralEditingWorkspace.vue', import.meta.url), 'utf8')
const api = () => readFile(new URL('../src/api/viralEditJobs.js', import.meta.url), 'utf8')
const dramaDetail = () => readFile(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const backendRoutes = () => readFile(new URL('../../backend-node/src/routes/index.js', import.meta.url), 'utf8')

test('episode ordering is explicit, immutable, and bounded', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.equal(moveViralEpisode(list, 0, 'up'), list, '边界外移动必须原样返回（同一引用，不触发无谓重渲染）')
  assert.equal(moveViralEpisode(list, 2, 'down'), list)
  assert.deepEqual(moveViralEpisode(list, 1, 'up').map((item) => item.id), [2, 1, 3])
  assert.deepEqual(moveViralEpisode(list, 0, 'down').map((item) => item.id), [2, 1, 3])
  assert.deepEqual(list.map((item) => item.id), [1, 2, 3], '不能修改原数组')
})

test('rating, timeline and billing projections render structured results for manual review', () => {
  assert.equal(viralStatusName('reconciliation'), '待对账')
  assert.equal(viralModeName('jump_cut'), '跳剪')
  assert.equal(viralDurationText(95_000), '1 分 35 秒')
  assert.equal(viralRatingText({ rating_counts: { S: 2, A: 0, B: 1, C: 0 }, avg_highlight_score: 88 }), 'S×2 · B×1 · 平均 88')
  // 回归：供应商没回 highlight_score 时 avg 为 null，Number(null)=0 曾把「平均 null」渲染上卡片。
  assert.equal(viralRatingText({ rating_counts: { S: 1, A: 1, B: 2, C: 1 }, avg_highlight_score: null }), 'S×1 · A×1 · B×2 · C×1')
  assert.deepEqual(viralGradeChips({ rating_counts: { S: 1, A: 0, B: 2, C: 0 } }), [{ grade: 'S', count: 1 }, { grade: 'B', count: 2 }])
  const segments = viralTimelineSegments([
    { ref: 'ep1_seg1', clip_start_sec: 0, clip_end_sec: 4, rating: 'S', content_desc: '冲突' },
    { ref: 'ep2_seg3', clip_start_sec: 4, clip_end_sec: 8, is_intro_dup: true, rating: 'B', content_desc: '前置' },
  ])
  assert.equal(segments[1].is_intro_dup, true)
  assert.equal(segments[0].rating, 'S')
  assert.equal(viralBillingText({ billing: { state: 'settled', charged_credits: 883.8425 } }), '实际扣费 883.84 积分 · 按实测输出时长结算')
  assert.match(viralBillingText({ billing: { state: 'reconciling', reserved_credits: 55 } }), /对账中.*冻结中/)
  assert.equal(viralBillingText({ billing: { state: 'released' } }), '预授权已释放，未扣费')
})

test('workspace calls only the registered viral-edit routes', async () => {
  const [client, routes] = await Promise.all([api(), backendRoutes()])
  for (const path of ['/viral-edit-jobs/quote', '/viral-edit-jobs', '/viral-edit-jobs/${id}/outputs/${clipIndex}/save-asset']) {
    assert.ok(client.includes(path.startsWith('/') && !path.includes('${') ? `'${path}'` : path), `前端缺少 ${path}`)
  }
  for (const line of [
    "r.post('/viral-edit-jobs/quote', viralEditJobs.quote)",
    "r.post('/viral-edit-jobs', viralEditJobs.create)",
    "r.get('/viral-edit-jobs', viralEditJobs.list)",
    "r.get('/viral-edit-jobs/:id', viralEditJobs.get)",
    "r.post('/viral-edit-jobs/:id/outputs/:clipIndex/save-asset', viralEditJobs.saveAsset)",
  ]) {
    assert.ok(routes.includes(line), `后端未注册 ${line}`)
  }
})

test('投流素材 tab is registered in the project workspace', async () => {
  const detail = await dramaDetail()
  assert.match(detail, /\{v:'viral',label:'投流素材'\}/)
  assert.match(detail, /<ViralEditingWorkspace v-if="workspaceTab === 'viral'" :drama-id="dramaId" :can-edit="drama\?\.permissions\?\.can_edit !== false" \/>/)
})

test('workspace keeps provider signed URLs out of playback and gates paid submit on quote', async () => {
  const source = await component()
  assert.doesNotMatch(source, /preview_url/, '供应商 3 天签名链接不得进入前端结果')
  assert.match(source, /<video v-if="output\.url" :src="output\.url" controls/, '成片走 /static 本地路径播放')
  assert.match(source, /ElMessageBox\.confirm\(/, '提交前必须确认付费调用')
  assert.match(source, /:disabled="!ready \|\| !quote \|\| submitting"/)
  // 报价自动计算：勾选/参数变化即防抖重算，不允许要求用户手动点「计算预估费用」。
  assert.match(source, /quoteTimer = setTimeout\(loadQuote, 400\)/)
  assert.match(source, /watch\(\(\) => \[selected\.value\.map\(\(episode\) => String\(episode\.id\)\)\.join\(','\), params\.value\.mode, params\.value\.max_clip_count, params\.value\.min_clip_duration, params\.value\.max_clip_duration, params\.value\.aspect_ratio, params\.value\.preset_intro\], scheduleQuote\)/)
  assert.doesNotMatch(source, /计算预估费用<\/button>/, '不允许把手动报价按钮放回')
  assert.match(source, /if \(version !== quoteVersion\) return/, '过期报价响应必须丢弃')
  // 回归：报价载荷是 {episodes, totals, params, quote}，模板绑定 quote.amount；
  // 不拍平就会渲染出空白金额（隐藏页验收时实际踩到）。
  assert.match(source, /quote\.value = result \? \{ \.\.\.result\.quote, totals: result\.totals, episodes: result\.episodes \} : null/)
  assert.match(source, /timer = setInterval\(refreshJobs, 15000\)/)
  assert.match(source, /if \(disposed\) return/, '挂载竞态：卸载后不得再建 15s 轮询')
  assert.match(source, /onUnmounted\(\(\) => \{ disposed = true; clearInterval\(timer\); clearTimeout\(quoteTimer\) \}\)/)
  assert.match(source, /idempotency_key: pendingKey/)
  assert.match(source, /:disabled="!canEdit" @click="saveAsset/, '无编辑权限不能保存为素材')
  assert.match(source, /formatChinaDateTime\(job\.created_at\)/, '时间按 Asia/Shanghai 展示')
  assert.match(source, /输入需携带内嵌字幕/, '字幕是官方硬性要求，需要前置提示')
})

test('管理台按投流剪辑口径收口：second 整数用量、任务标签与治理渲染', async () => {
  const [admin, costs, nginx] = await Promise.all([
    readFile(new URL('../src/views/AdminConsole.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/utils/costPresentation.js', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/nginx-drama-richbest.conf', import.meta.url), 'utf8'),
  ])
  // 后端 normalizeUsage 要求全部计量器为非负整数；second 漏进小数输入档会让管理员按预填值提交即报「非法用量」。
  assert.match(admin, /const INTEGER_METERS = new Set\(\[[^\]]*'second'\]\)/)
  assert.match(admin, /if \(task\.kind === 'viral_edit_job'\)/, '对账案件的任务定位必须认得投流剪辑，而不是回退英文原串')
  assert.match(admin, /overview\?\.las\?\.viral/, 'lasSummary.viral 治理统计要有渲染（待对账/中转待回收告警位）')
  assert.match(costs, /viral_edit_job: '投流剪辑'/, '成本/用量表的来源标签不能露 source_kind 原串')
  assert.match(nginx, /client_body_timeout 300s;/, '2GB 慢传中途停顿不能被默认 60s 掐断')
  assert.match(nginx, /proxy_request_buffering off;/, '不关缓冲则每个并发上传先整体落盘 2.1GB，磁盘余量会被吃掉')
})

test('workspace layout survives the three desktop viewports without truncating clips', async () => {
  const source = await component()
  assert.match(source, /\.viral-layout\{display:grid;grid-template-columns:minmax\(340px,1fr\) minmax\(0,1\.2fr\)/)
  assert.match(source, /@media\(max-width:1100px\)\{\.viral-layout\{grid-template-columns:1fr\}\}/, '窄屏必须回退为单列')
  assert.match(source, /\.clips\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,280px\),1fr\)\)/, '成片网格按容器收缩，不在 1280 宽下截断')
  assert.match(source, /\.clip video\{display:block;width:100%;max-height:300px/, '视频限高但不锁死页面滚动')
})

test('picker「只看成片」filters merged finals, orders them by episode number, and hints at truncation', () => {
  const assets = [
    { id: 3, name: '上传素材', source_type: 'upload' },
    { id: 7, name: '第2集 成片', source_type: 'merged_final' },
    { id: 5, name: '第10集 成片', source_type: 'merged_final' },
    { id: 9, name: '第1集 成片', source_type: 'merged_final' },
  ]
  assert.equal(viralPickerAssets(assets, false), assets, '关闭开关时保持原有顺序与全量（同一引用）')
  assert.deepEqual(viralPickerAssets(assets, true).map((asset) => asset.name), ['第1集 成片', '第2集 成片', '第10集 成片'])
  assert.equal(viralFinalsOnly(assets, true).length, 3)
  assert.equal(viralEpisodeOrder({ name: '第12集 成片：反转' }), 12)
  assert.equal(viralEpisodeOrder({ name: '改过名的素材' }), null)
  assert.deepEqual(viralSortedAssets([{ id: 2, name: '普通素材' }, { id: 1, name: '普通素材B' }]).map((asset) => asset.id), [1, 2], '无集号素材按 id 兜底排序')
  assert.equal(viralTruncationHint({ total: 260, page_size: 100 }), '素材较多，此处仅显示前 100 条（共 260 条），更多请到「制作资源 · 媒体」筛选')
  assert.equal(viralTruncationHint({ total: 80, page_size: 100 }), '')
  assert.equal(viralTruncationHint(undefined), '')
})

test('workspace exposes finals-only toggle, merged-final badge, truncation hint, and disposal-safe polling', async () => {
  const source = await component()
  assert.match(source, /v-model="finalsOnly"/)
  assert.match(source, /source_type === 'merged_final'/, '成片素材须带「成片」徽标')
  assert.match(source, /viralTruncationHint\(assets\?\.pagination\)/, '素材超过单页上限时必须给出截断提示')
  assert.match(source, /if \(disposed\) return/, '挂载竞态：卸载后不得再建 15s 轮询')
  assert.match(source, /disposed = true; clearInterval\(timer\)/)
  assert.doesNotMatch(source, /v-if="job\.status === 'completed' && job\.outputs\.length"/, '对账/失败任务的已下载成片也须展示并可保存')
})
