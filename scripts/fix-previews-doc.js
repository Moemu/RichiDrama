const fs = require('fs');
const f = 'deploy/PR_PREVIEWS.md';
let s = fs.readFileSync(f, 'utf8');
const start = s.indexOf('## 预览架构');
const end = s.indexOf('## 首次服务器准备');
const BT = '`';
const mid = [
  '## 预览架构',
  '',
  '预览与生产**应用行为逐字段一致**：同一 Docker 网络、同一份环境配置（存储后端、OSS 凭据、外部集成）、同一套媒体服务路径。唯一允许的差异：',
  '',
  '- **数据集**：每个 PR 使用生产库在线快照的隔离副本（迁移先双跑验证），预览内的写操作不会触碰生产数据。',
  `- **页面标题**：预览镜像构建时把 ${BT} (preview)${BT} 后缀写入静态 ${BT}<title>${BT}，并以 ${BT}VITE_TITLE_BADGE${BT} 烘焙进前端产物（${BT}Dockerfile.preview${BT} 的 ${BT}PREVIEW_TITLE_BADGE${BT}，生产构建该参数为空），路由切换重写 ${BT}document.title${BT} 后后缀仍然保留。`,
  '',
  '结构上只有三件套：',
  '',
  `- 每个 PR 一个容器 ${BT}minidrama-pr-<number>${BT}，加入**生产所在的 Docker 网络**（${BT}lens-rhyme_default${BT}），别名 ${BT}pr-<number>${BT}——与生产应用同构的网络位置。`,
  `- 端口 80 入口加载一份静态 vhost ${BT}deploy/nginx-preview-vhost.conf${BT}：按 ${BT}pr-<number>.preview.drama.richbest.cn${BT} 匹配主机名，经 Basic Auth 后代理到对应容器。文件不随预览增删变化。`,
  `- ${BT}MINIDRAMA_PROFILE=preview${BT} 标记运行档位（配置为空集，仅作 /ready 与日志的可观测信号）。`,
  '',
  `基本鉴权凭据共享于 ${BT}/data/minidrama-previews/auth${BT}。这是单人仓库下的有意取舍：预览代码即仓库成员自己的代码，作者门禁（author_association + 同仓库分支校验）是真正的安全边界，预览不应也无法“防御”作者本人。`,
  '',
  '迁移安全不变：预览数据来自生产库在线快照，迁移先在快照副本上双跑验证后才启动预览应用。',
  '',
  '',
].join('\n');
fs.writeFileSync(f, before + mid + after);

// Also fix the 首次服务器准备 section: remove edge/network references.
let s2 = fs.readFileSync(f, 'utf8');
s2 = s2.replace(
  /当前服务器使用两个长驻容器：[\s\S]*?保证其默认路由不变）。\n/,
  [
    '当前服务器使用一个入口容器：',
    '',
    `- ${BT}lens-rhyme-nginx-1${BT} 处理端口 80（生产站点与预览域名的鉴权代理）。`,
    '',
    '预览容器由预览部署自动创建/更新，与生产应用同网络位置。',
    '',
  ].join('\n'),
);
fs.writeFileSync(f, s2);
console.log('fixed');
