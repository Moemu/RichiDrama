'use strict';

// multer（diskStorage）先把请求体整体落盘，守卫/项目操作中间件随后可能在进入
// uploadMedia 之前拒绝请求——那时不会经过 mediaAsset.upload 的 finally。
// 这里在响应结束/连接关闭时兜底删除临时文件：成功路径文件已被 rename 转正，
// rmSync(force) 为幂等空操作；multer 自身的超限/中断清理不受影响。
module.exports = function uploadTempBackstop(req, res, next) {
  if (req.file && req.file.path) {
    const tempPath = req.file.path;
    const removeTemp = () => { try { require('node:fs').rmSync(tempPath, { force: true }); } catch (_) { /* 已转正或已被清理 */ } };
    res.on('finish', removeTemp);
    res.on('close', removeTemp);
  }
  next();
};
