const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadConfig } = require('../config');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { resolveStorageFile } = require('../utils/storagePath');
const boardService = require('./creativeBoardService');

function storageRoot() {
  const configured = loadConfig().storage?.local_path || './data/storage';
  return path.resolve(configured);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.slice(-500) || `媒体处理失败 (${code})`)));
  });
}

async function probe(file) {
  const raw = await run(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]);
  const data = JSON.parse(raw);
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video?.height || !Number.isFinite(Number(data.format?.duration))) throw new Error('视频文件规格无法读取');
  return { width: video.width, height: video.height, seconds: Number(data.format.duration), audio: data.streams.some((stream) => stream.codec_type === 'audio') };
}

function validateSubtitles(subtitles, durationMs) {
  if (subtitles == null) return [];
  if (!Array.isArray(subtitles) || subtitles.length > 300) throw new Error('字幕格式无效');
  let lastEnd = 0;
  return subtitles.map((item) => {
    const start_ms = Number(item.start_ms);
    const end_ms = Number(item.end_ms);
    const text = String(item.text || '').trim();
    if (!Number.isInteger(start_ms) || !Number.isInteger(end_ms) || start_ms < lastEnd || end_ms <= start_ms || end_ms > durationMs || !text || text.length > 300) throw new Error('字幕时间或内容无效');
    lastEnd = end_ms;
    return { start_ms, end_ms, text };
  });
}

function stamp(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

function srtText(subtitles) {
  return '\uFEFF' + subtitles.map((item, index) => `${index + 1}\n${stamp(item.start_ms)} --> ${stamp(item.end_ms)}\n${item.text}\n`).join('\n');
}

function subtitleFilter(file) {
  let value = path.resolve(file).replace(/\\/g, '/');
  value = value.replace(/^([A-Za-z]):/, '$1\\:').replace(/'/g, "\\'").replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return `subtitles='${value}'`;
}

function deliveryItem(row) {
  return { id: row.id, board_id: row.board_id, status: row.status, error_msg: row.error_msg, input: JSON.parse(row.input_json), finished_url: row.finished_local_path ? `/static/${row.finished_local_path}` : null, clean_url: row.clean_local_path ? `/static/${row.clean_local_path}` : null, srt_url: row.srt_local_path ? `/static/${row.srt_local_path}` : null, created_at: row.created_at, updated_at: row.updated_at };
}

function ownedDelivery(db, id, ownerId) {
  const row = db.prepare('SELECT * FROM creative_board_deliveries WHERE id=? AND owner_user_id=?').get(Number(id), Number(ownerId));
  if (!row) throw new Error('交付任务不存在或无权访问');
  return deliveryItem(row);
}

function list(db, boardId, ownerId) {
  boardService.assertBoard(db, boardId, ownerId);
  return db.prepare('SELECT * FROM creative_board_deliveries WHERE board_id=? AND owner_user_id=? ORDER BY id DESC').all(Number(boardId), Number(ownerId)).map(deliveryItem);
}

async function validatedInput(db, boardId, ownerId, body) {
  const ids = body?.video_generation_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => !Number.isInteger(Number(id)))) throw new Error('请选择有效的视频片段');
  const root = storageRoot();
  const videos = [];
  for (const value of ids) {
    const row = db.prepare("SELECT id, local_path, status FROM video_generations WHERE id=? AND owner_user_id=? AND deleted_at IS NULL").get(Number(value), ownerId);
    if (!row || row.status !== 'completed' || !row.local_path) throw new Error('片段未完成或无权访问');
    const file = resolveStorageFile(root, row.local_path);
    if (!fs.existsSync(file)) throw new Error('片段本地文件不可读');
    const media = await probe(file);
    if (media.seconds <= 0) throw new Error('片段时长无效');
    videos.push({ id: row.id, local_path: row.local_path, ...media });
  }
  const totalMs = Math.round(videos.reduce((sum, video) => sum + video.seconds, 0) * 1000);
  if (!Number.isFinite(totalMs) || totalMs <= 0) throw new Error('片段总时长无效');
  const subtitles = validateSubtitles(body.subtitles, totalMs);
  let bgm = null;
  if (body.bgm_asset_id) {
    const asset = boardService.ownedMedia(db, 'asset', body.bgm_asset_id, ownerId);
    if (!asset || asset.type !== 'audio' || !asset.local_path || !fs.existsSync(resolveStorageFile(root, asset.local_path))) throw new Error('BGM 素材不可用');
    bgm = { asset_id: asset.id, local_path: asset.local_path };
  }
  return { video_generation_ids: videos.map((video) => video.id), videos, subtitles, bgm, total_ms: totalMs };
}

async function create(db, log, boardId, ownerId, body) {
  boardService.assertBoard(db, boardId, ownerId);
  const key = String(body?.idempotency_key || '').trim().slice(0, 100);
  if (!key) throw new Error('交付请求缺少幂等键');
  const prior = db.prepare('SELECT * FROM creative_board_deliveries WHERE owner_user_id=? AND idempotency_key=?').get(ownerId, key);
  if (prior) {
    if (Number(prior.board_id) !== Number(boardId)) throw new Error('幂等键已用于其他画布');
    return deliveryItem(prior);
  }
  const input = await validatedInput(db, boardId, ownerId, body);
  const at = new Date().toISOString();
  const inserted = db.prepare("INSERT INTO creative_board_deliveries(board_id,owner_user_id,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run(Number(boardId), ownerId, key, JSON.stringify(input), at, at);
  const id = Number(inserted.lastInsertRowid);
  setImmediate(() => processDelivery(db, log, id).catch((error) => log.error('画布交付失败', { id, error: error.message })));
  return ownedDelivery(db, id, ownerId);
}

async function processDelivery(db, log, id) {
  const row = db.prepare("SELECT * FROM creative_board_deliveries WHERE id=? AND status='processing'").get(id);
  if (!row) return;
  const input = JSON.parse(row.input_json);
  const root = storageRoot();
  const relative = `boards/${row.board_id}/deliveries/${id}`;
  const dir = path.join(root, relative, 'clean.mp4');
  const folder = path.dirname(dir);
  fs.mkdirSync(folder, { recursive: true });
  const tempFiles = [];
  try {
    const first = input.videos[0];
    const width = first.width % 2 ? first.width - 1 : first.width;
    const height = first.height % 2 ? first.height - 1 : first.height;
    for (const [index, video] of input.videos.entries()) {
      const source = resolveStorageFile(root, video.local_path);
      if (!fs.existsSync(source)) throw new Error('交付片段本地文件丢失');
      const temp = path.join(folder, `clip_${index}.mp4`);
      tempFiles.push(temp);
      const args = ['-y', '-i', source];
      if (!video.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      args.push('-map', '0:v:0', '-map', video.audio ? '0:a:0' : '1:a:0', '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', temp);
      await run(getFfmpegPath(), args);
    }
    const listFile = path.join(folder, 'concat.txt');
    tempFiles.push(listFile);
    fs.writeFileSync(listFile, tempFiles.filter((name) => name.endsWith('.mp4')).map((name) => `file '${name.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const clean = path.join(folder, 'clean.mp4');
    await run(getFfmpegPath(), ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', clean]);
    const srt = path.join(folder, 'subtitles.srt');
    const hasSubtitles = !!input.subtitles?.length;
    if (hasSubtitles) fs.writeFileSync(srt, srtText(input.subtitles), 'utf8');
    const finished = path.join(folder, 'finished.mp4');
    const args = ['-y', '-i', clean];
    if (input.bgm) args.push('-stream_loop', '-1', '-i', resolveStorageFile(root, input.bgm.local_path));
    if (hasSubtitles) args.push('-vf', subtitleFilter(srt));
    args.push('-map', '0:v:0');
    if (input.bgm) args.push('-filter_complex', '[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0[a]', '-map', '[a]');
    else args.push('-map', '0:a:0');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', finished);
    if (hasSubtitles || input.bgm) await run(getFfmpegPath(), args);
    else fs.copyFileSync(clean, finished);
    if (![clean, finished, ...(hasSubtitles ? [srt] : [])].every((file) => fs.existsSync(file) && fs.statSync(file).size > 0)) throw new Error('导出文件未生成完整');
    for (const file of [clean, finished]) {
      const media = await probe(file);
      if (media.seconds <= 0 || Math.abs(media.seconds * 1000 - input.total_ms) > 1500) throw new Error('交付成片规格或时长无效');
    }
    db.prepare("UPDATE creative_board_deliveries SET status='completed',clean_local_path=?,finished_local_path=?,srt_local_path=?,error_msg=NULL,updated_at=? WHERE id=?")
      .run(`${relative}/clean.mp4`, `${relative}/finished.mp4`, hasSubtitles ? `${relative}/subtitles.srt` : null, new Date().toISOString(), id);
  } catch (error) {
    db.prepare("UPDATE creative_board_deliveries SET status='failed',error_msg=?,updated_at=? WHERE id=?")
      .run(String(error.message).slice(0, 500), new Date().toISOString(), id);
    log.error('画布交付处理失败', { id, error: error.message });
  } finally {
    for (const file of tempFiles) { try { fs.unlinkSync(file); } catch (_) {} }
  }
}

function resume(db, log) {
  const rows = db.prepare("SELECT id FROM creative_board_deliveries WHERE status='processing'").all();
  for (const row of rows) setImmediate(() => processDelivery(db, log, row.id).catch((error) => log.error('画布交付恢复失败', { id: row.id, error: error.message })));
  return rows.length;
}

module.exports = { create, list, ownedDelivery, resume, validateSubtitles, srtText, processDelivery };
