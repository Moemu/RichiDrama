/**
 * 上传文件大小/格式限制（前端常量）
 *
 * 这些值必须与后端实际限制保持一致，否则会出现：
 * - 前端放行、后端拒绝 → 用户看到「图片大小不能超过 16MB」之类的后端报错
 * - 前端放行、nginx 拒绝 → 用户看到 413 Request Entity Too Large
 *
 * 对应的后端来源：
 *   图片：backend-node/src/routes/upload.js  → multer fileSize (16MB)
 *   音频：backend-node/src/routes/upload.js  → multer fileSize (10MB)
 *   nginx：deploy/nginx-drama-richbest.conf  → client_max_body_size 20m（覆盖后端，含 multipart 封装开销）
 *
 * 修改任一处时请同步检查另两处，避免限制不一致。
 */

/** 单张图片上限（MB）。与后端 upload.js 的 MAX_IMAGE_SIZE_MB 对齐 */
export const MAX_IMAGE_SIZE_MB = 16

/** 音频上限（MB）。与后端 upload.js 的 audioMaxSize 对齐（SD2 音色参考） */
export const MAX_AUDIO_SIZE_MB = 10

/** 允许的图片 MIME 类型，与后端 upload.js allowedTypes 对齐 */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']

/** 用于 <input accept> 的图片格式字符串 */
export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp'

const MB = 1024 * 1024

/** 校验图片文件大小是否在限制内，返回 { ok, message } */
export function checkImageSize(file) {
  if (!file) return { ok: false, message: '未选择文件' }
  if (file.size > MAX_IMAGE_SIZE_MB * MB) {
    return {
      ok: false,
      message: `图片大小不能超过 ${MAX_IMAGE_SIZE_MB}MB，当前文件约 ${Math.ceil(file.size / MB)}MB，请压缩后重试`
    }
  }
  return { ok: true }
}

/** 校验图片文件 MIME 是否被允许，返回 { ok, message } */
export function checkImageType(file) {
  if (!file) return { ok: false, message: '未选择文件' }
  const ct = file.type || ''
  if (!ALLOWED_IMAGE_TYPES.includes(ct)) {
    return { ok: false, message: '只支持图片格式 (jpg, png, gif, webp)' }
  }
  return { ok: true }
}

/** 综合校验图片文件（类型 + 大小），返回 { ok, message } */
export function checkImageFile(file) {
  const typeResult = checkImageType(file)
  if (!typeResult.ok) return typeResult
  return checkImageSize(file)
}
