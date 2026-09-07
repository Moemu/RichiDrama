// 项目导出服务：将剧集所有数据和媒体文件打包为 ZIP
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const EXPORT_VERSION = '1.5';  // 1.5: 保留 Omni 资产、资源关联及分镜生成设置；兼容导入旧版本 ZIP

function getStoragePath(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

async function safeReadMedia(cfg, storagePath, localPath) {
  try { return await require('./mediaStorageService').readMediaBuffer(cfg, storagePath, localPath); }
  catch (_) { return null; }
}

function localPathToAbs(storagePath, relPath) {
  if (!relPath) return null;
  return path.join(storagePath, relPath);
}

function extOf(relPath) {
  if (!relPath) return '.jpg';
  return path.extname(relPath) || '.jpg';
}

/** 解析 extra_images JSON 字段，返回本地路径数组 */
function parseExtraImages(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (_) { return []; }
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function parseJsonArray(raw) {
  const value = parseJson(raw, []);
  return Array.isArray(value) ? value : [];
}

function parseJsonObject(raw) {
  const value = parseJson(raw, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const EXPORT_FIRST_FRAME_TYPES = ['storyboard_first', 'first', 'first_frame'];
const EXPORT_LAST_FRAME_TYPES = ['storyboard_last', 'last', 'tail', 'last_frame'];

/** frame_prompts 表无记录时，从首尾帧图生历史补全导出（避免仅生过图、未单独存帧提示词时丢失） */
function supplementFramePromptsFromImageGens(db, sbId, fps) {
  const out = Array.isArray(fps) ? [...fps] : [];
  const hasType = (t) => out.some((f) => f && f.frame_type === t);
  const pickPrompt = (types) => {
    const ph = types.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT prompt FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL
       AND frame_type IN (${ph}) AND prompt IS NOT NULL AND TRIM(prompt) != ''
       ORDER BY created_at DESC LIMIT 1`
    ).get(sbId, ...types);
    return (row?.prompt || '').trim();
  };
  const now = new Date().toISOString();
  if (!hasType('first')) {
    const p = pickPrompt(EXPORT_FIRST_FRAME_TYPES);
    if (p) out.push({ frame_type: 'first', prompt: p, description: null, layout: null, created_at: now, updated_at: now });
  }
  if (!hasType('last')) {
    const p = pickPrompt(EXPORT_LAST_FRAME_TYPES);
    if (p) out.push({ frame_type: 'last', prompt: p, description: null, layout: null, created_at: now, updated_at: now });
  }
  return out;
}

/** 解析 storyboard.characters JSON 字段，返回 ID 数组 */
function parseSbChars(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(Number).filter(n => !isNaN(n)) : [];
  } catch (_) { return []; }
}

/**
 * 导出一个剧集为 ZIP Buffer
 * @returns {Buffer}
 */
async function exportDrama(db, cfg, log, dramaId) {
  const storagePath = getStoragePath(cfg);

  // ---- 1. 读取 drama 基本信息 ----
  const drama = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
  if (!drama) throw new Error('剧本不存在');

  let metadata = {};
  try { metadata = drama.metadata ? (typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata) : {}; } catch (_) {}

  // ---- 2. 读取所有剧集 ----
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number'
  ).all(Number(dramaId));

  // ---- 3. 读取各集分镜 ----
  const episodeIds = episodes.map(e => e.id);
  const storyboardsByEp = {};
  for (const ep of episodes) {
    storyboardsByEp[ep.id] = db.prepare(
      `SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY ${require('./storyboardIdentityService').orderSql(db)}`
    ).all(ep.id);
  }

  // ---- 4. 读取分镜图（完整历史 + 首尾帧 first/last）和视频（取最新完成的） ----
  const allSbIds = Object.values(storyboardsByEp).flat().map(s => s.id);
  const allImagesBySb = {};  // sbId -> 所有 image_generations 记录（用于导出历史和首尾帧绑定）
  const videosBySb = {};
  for (const sbId of allSbIds) {
    // 导出所有非删除的图片生成记录（含历史、首尾帧、各种 frame_type），仅打包有 local_path 的文件
    const igs = db.prepare(
      "SELECT * FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL ORDER BY created_at ASC"
    ).all(sbId);
    allImagesBySb[sbId] = igs.filter(ig => ig && ig.local_path);

    // An explicitly adopted version is authoritative. If it is failed or
    // processing, do not silently export another historical completed video.
    const active = db.prepare('SELECT active_video_generation_id FROM storyboards WHERE id=? AND deleted_at IS NULL').get(sbId);
    const vg = active?.active_video_generation_id != null
      ? db.prepare("SELECT video_url, local_path FROM video_generations WHERE id=? AND status = 'completed' AND deleted_at IS NULL").get(active.active_video_generation_id)
      : db.prepare("SELECT video_url, local_path FROM video_generations WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1").get(sbId);
    if (vg) videosBySb[sbId] = vg;
  }

  // 收集需要打包的分镜图片文件（完整历史）
  const imageFilesToPack = [];
  for (const [sbIdStr, igs] of Object.entries(allImagesBySb)) {
    const sbId = Number(sbIdStr);
    for (const ig of igs) {
      if (!ig.local_path) continue;
      const zipPath = `media/storyboards/sb_${sbId}_gen_${ig.id}${extOf(ig.local_path)}`;
      imageFilesToPack.push({ localRelPath: ig.local_path, zipPath });
    }
  }

  // 预查询各分镜的帧提示词（首尾帧专用提示词编辑器内容，必须导出否则导入后丢失）
  const framePromptsBySb = {};
  for (const sbId of allSbIds) {
    try {
      const fps = db.prepare('SELECT frame_type, prompt, description, layout, created_at, updated_at FROM frame_prompts WHERE storyboard_id = ? ORDER BY created_at ASC').all(sbId);
      framePromptsBySb[sbId] = supplementFramePromptsFromImageGens(db, sbId, fps);
    } catch (_) { framePromptsBySb[sbId] = []; }
  }

  // ---- 5. 读取角色 ----
  const characters = db.prepare(
    'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order, id'
  ).all(Number(dramaId));

  // ---- 6. 读取场景 ----
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
  ).all(Number(dramaId));

  // ---- 7. 读取道具 ----
  const props = db.prepare(
    'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
  ).all(Number(dramaId));

  // ---- 场景去重（数据库中可能存在同 location+time 的重复记录，导出时只保留第一条）----
  const seenSceneKeys = new Set();
  const dedupedScenes = [];
  for (const s of scenes) {
    const key = `${(s.location || '').trim()}|${(s.time || '').trim()}`;
    if (seenSceneKeys.has(key)) continue;
    seenSceneKeys.add(key);
    dedupedScenes.push(s);
  }
  // 为去重后被丢弃的重复场景 ID 建立到保留场景的映射，确保分镜 scene_index 仍指向保留的场景
  const sceneDedupeIdMap = new Map(); // 原 ID → 保留后的同 key 首个 ID
  for (const s of scenes) {
    const key = `${(s.location || '').trim()}|${(s.time || '').trim()}`;
    const kept = dedupedScenes.find(d => `${(d.location||'').trim()}|${(d.time||'').trim()}` === key);
    if (kept) sceneDedupeIdMap.set(s.id, kept.id);
  }

  // ---- 构建 ID → 导出数组下标 的映射（用于分镜 characters/scene_id/prop_ids 跨项目还原） ----
  const charIdToIndex = {};
  characters.forEach((c, idx) => { charIdToIndex[c.id] = idx; });
  const sceneIdToIndex = {};
  dedupedScenes.forEach((s, idx) => { sceneIdToIndex[s.id] = idx; });
  // 去重丢弃的重复场景 ID 也指向保留场景的下标
  for (const [origId, keptId] of sceneDedupeIdMap.entries()) {
    if (!(origId in sceneIdToIndex)) sceneIdToIndex[origId] = sceneIdToIndex[keptId];
  }
  const propIdToIndex = {};
  props.forEach((p, idx) => { propIdToIndex[p.id] = idx; });

  // ---- 7b. 读取 Omni 素材及项目资源关联 ----
  // Storyboards store database IDs for editable references.  Export the
  // project assets and referenced global assets, then use archive-local
  // indexes so importing into another project never reuses stale IDs.
  const referencedAssetIds = new Set();
  for (const sb of Object.values(storyboardsByEp).flat()) {
    for (const id of parseJsonArray(sb.omni_asset_ids)) {
      if (Number.isFinite(Number(id))) referencedAssetIds.add(Number(id));
    }
    for (const id of [sb.omni_first_frame_asset_id, sb.omni_last_frame_asset_id]) {
      if (id != null && Number.isFinite(Number(id))) referencedAssetIds.add(Number(id));
    }
    for (const id of Object.keys(parseJsonObject(sb.omni_asset_usage_json))) {
      if (Number.isFinite(Number(id))) referencedAssetIds.add(Number(id));
    }
    const document = parseJsonObject(sb.omni_prompt_document_json);
    for (const ref of (Array.isArray(document.refs) ? document.refs : [])) {
      if (ref?.asset_id != null && Number.isFinite(Number(ref.asset_id))) referencedAssetIds.add(Number(ref.asset_id));
    }
  }

  // A project-resource mapping may point at a global asset instead of a
  // project-owned row. Include those mappings in the same reference set.
  const resourceAssetRows = db.prepare(
    'SELECT asset_id FROM asset_resource_links WHERE drama_id = ? AND asset_id IS NOT NULL'
  ).all(Number(dramaId));
  for (const row of resourceAssetRows) {
    if (Number.isSafeInteger(Number(row.asset_id))) referencedAssetIds.add(Number(row.asset_id));
  }

  const exportedAssets = [];
  const assetById = new Map();
  const assetFilesToPack = [];
  const projectAssetRows = db.prepare(
    'SELECT * FROM assets WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
  ).all(Number(dramaId));
  const selectedAssetRows = new Map(projectAssetRows.map((row) => [Number(row.id), row]));
  const queuedAssetIds = new Set();
  const pendingAssetIds = [];
  const queueAsset = (rawId) => {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || selectedAssetRows.has(id) || queuedAssetIds.has(id)) return;
    queuedAssetIds.add(id);
    pendingAssetIds.push(id);
  };

  // Preserve parent references for project rows and explicitly referenced
  // globals. The query below admits only this project or this owner's globals.
  for (const row of projectAssetRows) queueAsset(row.parent_asset_id);
  for (const id of referencedAssetIds) queueAsset(id);
  while (pendingAssetIds.length > 0) {
    const batch = pendingAssetIds.splice(0, pendingAssetIds.length);
    for (let offset = 0; offset < batch.length; offset += 500) {
      const ids = batch.slice(offset, offset + 500);
      const placeholders = ids.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT * FROM assets
         WHERE deleted_at IS NULL AND id IN (${placeholders})
           AND (drama_id = ? OR (drama_id IS NULL AND owner_user_id = ?))`
      ).all(...ids, Number(dramaId), drama.owner_user_id ?? null);
      for (const row of rows) {
        const id = Number(row.id);
        if (selectedAssetRows.has(id)) continue;
        selectedAssetRows.set(id, row);
        queueAsset(row.parent_asset_id);
      }
    }
  }

  const rows = [...selectedAssetRows.values()];
  rows.sort((a, b) => {
    const aIsProject = Number(a.drama_id) === Number(dramaId);
    const bIsProject = Number(b.drama_id) === Number(dramaId);
    return Number(bIsProject) - Number(aIsProject) || Number(a.id) - Number(b.id);
  });
  rows.forEach((row, index) => { assetById.set(Number(row.id), index); });
  for (const row of rows) {
    const item = {
      original_id: Number(row.id),
      name: row.name || null,
      reference_alias: row.reference_alias || null,
      type: row.type || 'image',
      category: row.category || null,
      url: row.url || null,
      file_size: row.file_size ?? null,
      mime_type: row.mime_type || null,
      width: row.width ?? null,
      height: row.height ?? null,
      duration: row.duration ?? null,
      image_gen_id: row.image_gen_id ?? null,
      video_gen_id: row.video_gen_id ?? null,
      source_type: row.source_type || 'upload',
      parent_asset_index: row.parent_asset_id != null && assetById.has(Number(row.parent_asset_id)) ? assetById.get(Number(row.parent_asset_id)) : null,
      metadata: parseJson(row.metadata_json, null),
      tags: parseJson(row.tags_json, null),
      is_favorite: !!row.is_favorite,
      checksum: row.checksum || null,
      processing_status: row.processing_status || 'ready',
      error_msg: row.error_msg || null,
      seedance2_asset: parseJson(row.seedance2_asset, null),
      requires_sd2_identity: !!row.requires_sd2_identity,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      archived_at: row.archived_at || null,
      file: row.local_path ? `media/assets/asset_${row.id}${extOf(row.local_path)}` : null,
      thumbnail_file: row.thumbnail_local_path ? `media/assets/asset_${row.id}_thumb${extOf(row.thumbnail_local_path)}` : null,
    };
    if (row.local_path) assetFilesToPack.push({ localRelPath: row.local_path, zipPath: item.file });
    if (row.thumbnail_local_path) assetFilesToPack.push({ localRelPath: row.thumbnail_local_path, zipPath: item.thumbnail_file });
    exportedAssets.push(item);
  }

  const exportedResourceLinks = [];
  const resourceRows = db.prepare('SELECT * FROM asset_resource_links WHERE drama_id = ? ORDER BY id').all(Number(dramaId));
  const resourceIndex = {
    character: new Map(characters.map((row, index) => [Number(row.id), index])),
    scene: new Map(dedupedScenes.map((row, index) => [Number(row.id), index])),
    prop: new Map(props.map((row, index) => [Number(row.id), index])),
  };
  for (const row of resourceRows) {
    const assetIndex = assetById.get(Number(row.asset_id));
    const resourceIndexValue = resourceIndex[row.resource_type]?.get(Number(row.resource_id));
    if (assetIndex == null || resourceIndexValue == null) continue;
    exportedResourceLinks.push({
      asset_index: assetIndex,
      resource_type: row.resource_type,
      resource_index: resourceIndexValue,
      role: row.role || 'primary_image',
      status: row.status || 'active',
      detached_at: row.detached_at || null,
    });
  }

  // ---- 读取所有分镜的道具关联（storyboard_props） ----
  const allSbIdsForProps = Object.values(storyboardsByEp).flat().map(s => s.id);
  const sbPropIds = {}; // storyboard_id → prop_id[]
  if (allSbIdsForProps.length > 0) {
    const placeholders = allSbIdsForProps.map(() => '?').join(',');
    const spRows = db.prepare(
      `SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`
    ).all(...allSbIdsForProps);
    for (const row of spRows) {
      if (!sbPropIds[row.storyboard_id]) sbPropIds[row.storyboard_id] = [];
      sbPropIds[row.storyboard_id].push(row.prop_id);
    }
  }

  // ---- 8. 组装 project.json ----
  // 收集 extra_images 需要打包的文件：{ localRelPath, zipPath }
  const extraFilesToPack = [];

  const zipData = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    drama: {
      title: drama.title,
      description: drama.description,
      genre: drama.genre,
      style: drama.style,
      status: drama.status,
      tags: drama.tags,
      metadata,
    },
    episodes: episodes.map(ep => {
      const sbs = storyboardsByEp[ep.id] || [];
      return {
        episode_number: ep.episode_number,
        title: ep.title,
        description: ep.description,
        script_content: ep.script_content,
        duration: ep.duration,
        storyboards: sbs.map(sb => {
          const igsForThis = allImagesBySb[sb.id] || [];
          // 兼容：仍提供 image_file（指向首帧或最新一张），旧版导入器可继续工作
          let mainIg = igsForThis.find(g => g.id === sb.first_frame_image_id) || igsForThis[igsForThis.length - 1];
          const sbImageFile = mainIg ? `media/storyboards/sb_${sb.id}_gen_${mainIg.id}${extOf(mainIg.local_path)}` : null;
          const vg = videosBySb[sb.id];
          const sbVideoFile = vg && vg.local_path ? `media/videos/sb_${sb.id}${extOf(vg.local_path)}` : null;
          const sbAudioFile = sb.audio_local_path
            ? `media/audio/sb_${sb.id}${extOf(sb.audio_local_path)}`
            : null;
          const sbNarrationAudioFile = sb.narration_audio_local_path
            ? `media/audio/sb_${sb.id}_narration${extOf(sb.narration_audio_local_path)}`
            : null;

          // characters: 存储角色在导出列表中的下标（而非原 ID），方便跨项目恢复
          const charIds = parseSbChars(sb.characters);
          const characterIndices = charIds
            .map(id => charIdToIndex[id])
            .filter(idx => idx !== undefined);

          // scene_id: 存储场景在导出列表中的下标
          const sceneIndex = sb.scene_id != null ? (sceneIdToIndex[sb.scene_id] ?? null) : null;

          // prop_ids: 存储道具在导出列表中的下标（storyboard_props 关联）
          const sbPropIdList = sbPropIds[sb.id] || [];
          const propIndices = sbPropIdList
            .map(id => propIdToIndex[id])
            .filter(idx => idx !== undefined);

          const omniAssetIds = parseJsonArray(sb.omni_asset_ids)
            .map((id) => assetById.get(Number(id)))
            .filter((index) => index != null);
          const omniAssetUsage = parseJsonObject(sb.omni_asset_usage_json);
          const exportedUsage = {};
          for (const [rawId, usage] of Object.entries(omniAssetUsage)) {
            const assetIndex = assetById.get(Number(rawId));
            if (assetIndex != null) exportedUsage[String(assetIndex)] = usage;
          }
          const promptDocument = parseJsonObject(sb.omni_prompt_document_json);
          const exportedPromptRefs = (Array.isArray(promptDocument.refs) ? promptDocument.refs : []).map((ref) => {
            const assetIndex = assetById.get(Number(ref?.asset_id));
            if (assetIndex == null) return null;
            const { asset_id, ...rest } = ref;
            return { ...rest, asset_index: assetIndex };
          }).filter(Boolean);
          const exportedPromptDocument = Object.keys(promptDocument).length
            ? { ...promptDocument, refs: exportedPromptRefs }
            : null;
          const firstFrameAssetIndex = sb.omni_first_frame_asset_id != null
            ? (assetById.get(Number(sb.omni_first_frame_asset_id)) ?? null) : null;
          const lastFrameAssetIndex = sb.omni_last_frame_asset_id != null
            ? (assetById.get(Number(sb.omni_last_frame_asset_id)) ?? null) : null;

          return {
            storyboard_number: sb.storyboard_number,
            title: sb.title,
            description: sb.description,
            location: sb.location,
            time: sb.time,
            dialogue: sb.dialogue,
            narration: sb.narration || null,
            action: sb.action,
            atmosphere: sb.atmosphere,
            result: sb.result,
            shot_type: sb.shot_type,
            angle: sb.angle,
            angle_h: sb.angle_h || null,
            angle_v: sb.angle_v || null,
            angle_s: sb.angle_s || null,
            movement: sb.movement,
            lighting_style: sb.lighting_style || null,
            depth_of_field: sb.depth_of_field || null,
            image_prompt: sb.image_prompt,
            polished_prompt: sb.polished_prompt || null,
            video_prompt: sb.video_prompt,
            duration: sb.duration,
            emotion: sb.emotion,
            emotion_intensity: sb.emotion_intensity,
            segment_index: sb.segment_index ?? 0,
            segment_title: sb.segment_title || null,
            continuity_snapshot: sb.continuity_snapshot || null,
            creation_mode: sb.creation_mode === 'universal' ? 'universal' : 'classic',
            universal_segment_text: sb.universal_segment_text || null,
            layout_description: sb.layout_description || null,
            text_model: sb.text_model || null,
            video_model: sb.video_model || null,
            video_resolution: sb.video_resolution || null,
            video_aspect_ratio: sb.video_aspect_ratio || null,
            video_upscale_resolution: sb.video_upscale_resolution || null,
            video_target_fps: sb.video_target_fps ?? null,
            generation_overrides: parseJsonObject(sb.generation_overrides_json),
            generation_overrides_json: parseJsonObject(sb.generation_overrides_json),
            audio_strategy: sb.audio_strategy || null,
            keep_original_audio: !!sb.keep_original_audio,
            audio_volume: sb.audio_volume ?? null,
            audio_fade_seconds: sb.audio_fade_seconds ?? null,
            omni_creation_mode: sb.omni_creation_mode || null,
            omni_asset_send_policy: sb.omni_asset_send_policy || null,
            omni_asset_refs: omniAssetIds.map((asset_index) => ({ asset_index, usage: exportedUsage[String(asset_index)] || null })),
            // These index-based aliases make the archive self-describing while
            // keeping the legacy field names available to older readers.
            omni_asset_ids: omniAssetIds,
            omni_asset_usage_json: exportedUsage,
            omni_first_frame_asset_index: firstFrameAssetIndex,
            omni_last_frame_asset_index: lastFrameAssetIndex,
            omni_asset_usage: exportedUsage,
            omni_prompt_document: exportedPromptDocument,
            omni_prompt_document_json: exportedPromptDocument,
            // 用 original_id 记录首尾帧绑定的 image_generations 旧ID，导入时映射回新ID
            first_frame_image_original_id: sb.first_frame_image_id ?? null,
            last_frame_image_original_id: sb.last_frame_image_id ?? null,
            last_frame_image_url: sb.last_frame_image_url || null,
            last_frame_local_path: sb.last_frame_local_path || null,
            character_indices: characterIndices,
            scene_index: sceneIndex,
            prop_indices: propIndices,
            image_file: sbImageFile,
            video_file: sbVideoFile,
            audio_file: sbAudioFile,
            narration_audio_file: sbNarrationAudioFile,
            // 完整分镜图片历史（含首尾帧），导入后可恢复 getSbAllImages + 绑定
            image_generations: igsForThis.map(ig => ({
              original_id: ig.id,
              provider: ig.provider || 'imported',
              prompt: ig.prompt || null,
              negative_prompt: ig.negative_prompt || null,
              model: ig.model || null,
              frame_type: ig.frame_type || null,
              size: ig.size || null,
              quality: ig.quality || null,
              status: ig.status || 'completed',
              error_msg: ig.error_msg || null,
              created_at: ig.created_at || null,
              updated_at: ig.updated_at || null,
              completed_at: ig.completed_at || null,
              zip_file: `media/storyboards/sb_${sb.id}_gen_${ig.id}${extOf(ig.local_path)}`,
            })),
            // 首尾帧提示词编辑器保存的专业提示词（含 layout）
            frame_prompts: framePromptsBySb[sb.id] || [],
          };
        }),
      };
    }),
    characters: characters.map((c, idx) => {
      // 收集 extra_images 文件
      const extras = parseExtraImages(c.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/characters/extra_char_${c.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        name: c.name,
        role: c.role,
        description: c.description,
        personality: c.personality,
        appearance: c.appearance,
        voice_style: c.voice_style,
        polished_prompt: c.polished_prompt || null,
        image_file: c.local_path ? `media/characters/char_${c.id}${extOf(c.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
    scenes: dedupedScenes.map(s => {
      const epIdx = episodeIds.indexOf(s.episode_id);
      const extras = parseExtraImages(s.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/scenes/extra_scene_${s.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        location: s.location,
        time: s.time,
        prompt: s.prompt,
        polished_prompt: s.polished_prompt || null,
        episode_index: epIdx >= 0 ? epIdx : null,
        image_file: s.local_path ? `media/scenes/scene_${s.id}${extOf(s.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
    props: props.map(p => {
      const epIdx = episodeIds.indexOf(p.episode_id);
      const extras = parseExtraImages(p.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/props/extra_prop_${p.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        name: p.name,
        type: p.type,
        description: p.description,
        prompt: p.prompt,
        episode_index: epIdx >= 0 ? epIdx : null,
        image_file: p.local_path ? `media/props/prop_${p.id}${extOf(p.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
    assets: exportedAssets,
    asset_resource_links: exportedResourceLinks,
  };

  // ---- 9. 打包 ZIP ----
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(zipData, null, 2), 'utf8'));

  // 分镜图片完整历史（含首尾帧 first/last 专用图 + 所有历史生成）
  for (const { localRelPath, zipPath } of imageFilesToPack) {
    const buf = await safeReadMedia(cfg, storagePath, localRelPath);
    if (buf) zip.addFile(zipPath, buf);
  }

  // 分镜视频
  for (const [sbId, vg] of Object.entries(videosBySb)) {
    if (vg.local_path) {
      const buf = await safeReadMedia(cfg, storagePath, vg.local_path);
      if (buf) zip.addFile(`media/videos/sb_${sbId}${extOf(vg.local_path)}`, buf);
    }
  }

  // 分镜对白 TTS / 解说旁白 TTS（分字段存储）
  for (const ep of episodes) {
    for (const sb of storyboardsByEp[ep.id] || []) {
      if (sb.audio_local_path) {
        const buf = await safeReadMedia(cfg, storagePath, sb.audio_local_path);
        if (buf) zip.addFile(`media/audio/sb_${sb.id}${extOf(sb.audio_local_path)}`, buf);
      }
      if (sb.narration_audio_local_path) {
        const buf = await safeReadMedia(cfg, storagePath, sb.narration_audio_local_path);
        if (buf) zip.addFile(`media/audio/sb_${sb.id}_narration${extOf(sb.narration_audio_local_path)}`, buf);
      }
    }
  }

  // 角色主图
  for (const c of characters) {
    if (c.local_path) {
      const buf = await safeReadMedia(cfg, storagePath, c.local_path);
      if (buf) zip.addFile(`media/characters/char_${c.id}${extOf(c.local_path)}`, buf);
    }
  }

  // 场景主图
  for (const s of dedupedScenes) {
    if (s.local_path) {
      const buf = await safeReadMedia(cfg, storagePath, s.local_path);
      if (buf) zip.addFile(`media/scenes/scene_${s.id}${extOf(s.local_path)}`, buf);
    }
  }

  // 道具主图
  for (const p of props) {
    if (p.local_path) {
      const buf = await safeReadMedia(cfg, storagePath, p.local_path);
      if (buf) zip.addFile(`media/props/prop_${p.id}${extOf(p.local_path)}`, buf);
    }
  }

  // extra_images（角色/场景/道具的额外参考图）
  for (const { localRelPath, zipPath } of extraFilesToPack) {
    const buf = await safeReadMedia(cfg, storagePath, localRelPath);
    if (buf) zip.addFile(zipPath, buf);
  }

  // Omni 素材主文件和缩略图
  for (const { localRelPath, zipPath } of assetFilesToPack) {
    const buf = await safeReadMedia(cfg, storagePath, localRelPath);
    if (buf) zip.addFile(zipPath, buf);
  }

  log.info('Drama exported', { drama_id: dramaId, title: drama.title });
  return { buffer: zip.toBuffer(), title: drama.title };
}

module.exports = { exportDrama };
