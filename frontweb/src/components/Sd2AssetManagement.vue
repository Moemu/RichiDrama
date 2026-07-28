<template>
  <div class="sd2-asset-mgmt tab-content">
    <el-alert type="info" :closable="false" class="sd2-intro" show-icon>
      <template #title>
        <span>
          对接火山方舟<strong>私有资产库</strong>（Seedance 2.0 等使用的 <code>asset://</code> 素材）。
          只需填写 <strong>Base URL + AK/SK + 项目名</strong>（资产组 Id 可留空，保存时自动创建）。
          <br /><strong>注意：</strong>AK/SK 必须是控制台
          <a href="https://console.volcengine.com/iam/keymanage" target="_blank" rel="noopener">IAM 访问密钥</a>（Access Key ID 形如 <code>AKLT...</code>），
          <strong>不是</strong>推理用的 ARK API Key（<code>ark-...</code>），否则会报 <code>401 the API key or AK/SK ... invalid</code>。
          若返回 <strong>403</strong> 且含 <code>not authorized</code> / <code>ark:CreateAssetGroup</code>，说明该 IAM 用户<strong>缺策略</strong>：在控制台为其绑定含 ModelArk 资产/资产组管理的权限（参见
          <a href="https://docs.byteplus.com/en/docs/ModelArk/1263493" target="_blank" rel="noopener">IAM 访问控制</a>）。
        </span>
      </template>
    </el-alert>

    <el-form label-width="120px" class="sd2-form">
      <el-form-item label="Base URL">
        <el-input
          v-model="baseUrl"
          placeholder="留空使用官方默认 https://ark.cn-beijing.volcengineapi.com/api/v3"
          clearable
        />
        <p class="field-hint">火山官方地址一般为 <code>https://ark.cn-beijing.volcengineapi.com/api/v3</code>；通常无需修改。</p>
      </el-form-item>
      <el-form-item label="Access Key ID">
        <el-input v-model="accessKeyId" placeholder="控制台 IAM 访问密钥 Access Key ID（AKLT 开头）" clearable />
      </el-form-item>
      <el-form-item label="Secret Key">
        <el-input v-model="secretAccessKey" type="password" show-password placeholder="Secret Access Key（不是推理 API Key）" clearable />
      </el-form-item>
      <el-form-item label="工程 / 项目名">
        <el-input
          v-model="projectName"
          placeholder="与控制台「项目」标识完全一致（区分大小写、下划线等）"
          clearable
        />
        <p class="field-hint">
          会写入 <strong>Query</strong> 与 <strong>JSON Body</strong> 的 <code>ProjectName</code>（与 Action 一并签名）。
          若报 403 且文案含 <code>project/*</code>，多为 IAM 未授权该动作。
        </p>
      </el-form-item>
      <el-form-item label="默认资产组 Id">
        <el-input
          v-model="assetGroupIdForCert"
          placeholder="留空则保存时自动创建一个资产组（AIGC 类型）并回填"
          clearable
        />
        <p class="field-hint">留空时，点「保存到 AI 配置」会自动调用 CreateAssetGroup 建组并填入；已填则以你填的为准。也可左侧资产组列表点选一行自动填入。</p>
      </el-form-item>
      <el-form-item label=" ">
        <div class="sd2-save-row">
          <el-button type="primary" :loading="savingConfig" @click="saveToAiConfig">
            保存到 AI 配置
          </el-button>
          <span v-if="savedConfigId" class="sd2-saved-hint">
            已关联配置 #{{ savedConfigId }}（创作页 SD2 认证在未配置「即梦2角色认证」时使用）
          </span>
        </div>
      </el-form-item>
    </el-form>

    <el-row :gutter="16">
      <el-col :span="11">
        <div class="panel-title">资产组</div>
        <div class="panel-actions">
          <el-button type="primary" size="small" :loading="loadingGroups" @click="refreshGroups">刷新列表</el-button>
          <el-button type="success" size="small" @click="openCreateGroup">新建组</el-button>
        </div>
        <el-table
          :data="groupRows"
          size="small"
          stripe
          highlight-current-row
          max-height="320"
          @current-change="onGroupRowChange"
        >
          <el-table-column prop="Id" label="Id" min-width="120" show-overflow-tooltip />
          <el-table-column prop="Name" label="名称" min-width="100" show-overflow-tooltip />
          <el-table-column label="操作" width="168" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="getGroupDetail(row)">详情</el-button>
              <el-button link type="primary" size="small" @click="openEditGroup(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="deleteGroup(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-col>
      <el-col :span="13">
        <div class="panel-title">资产（需组 Id）</div>
        <div class="panel-actions row-gap">
          <el-input v-model="assetGroupIdInput" placeholder="组 Id，或左侧点选一行" clearable style="flex: 1; min-width: 140px" />
          <el-button type="primary" size="small" :loading="loadingAssets" @click="refreshAssets">刷新</el-button>
          <el-button type="success" size="small" @click="openCreateAsset">新建资产</el-button>
        </div>
        <el-table :data="assetRows" size="small" stripe max-height="320">
          <el-table-column prop="Id" label="Id" min-width="120" show-overflow-tooltip />
          <el-table-column prop="Name" label="名称" min-width="90" show-overflow-tooltip />
          <el-table-column prop="AssetType" label="类型" width="88" />
          <el-table-column label="操作" width="168" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="getAssetDetail(row)">详情</el-button>
              <el-button link type="primary" size="small" @click="openEditAsset(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="deleteAsset(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-col>
    </el-row>

    <div class="panel-title" style="margin-top: 16px">最近一次响应（调试）</div>
    <el-input v-model="lastRawJson" type="textarea" :rows="6" readonly class="mono" />

    <!-- 新建资产组 -->
    <el-dialog v-model="dlgGroupCreate" title="CreateAssetGroup" width="480px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="Name" required>
          <el-input v-model="formGroupName" placeholder="资产组名称" />
        </el-form-item>
        <el-form-item label="扩展 JSON">
          <el-input v-model="formGroupExtraJson" type="textarea" :rows="3" placeholder='可选，合并进请求体，如 {"Description":"..."}' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgGroupCreate = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitCreateGroup">提交</el-button>
      </template>
    </el-dialog>

    <!-- 编辑资产组 -->
    <el-dialog v-model="dlgGroupEdit" title="UpdateAssetGroup" width="520px" destroy-on-close>
      <el-alert type="warning" :closable="false" title="按官方文档填写需更新的字段；以下为常用名称修改。" style="margin-bottom: 12px" />
      <el-form label-width="100px">
        <el-form-item label="Id" required>
          <el-input v-model="editGroupId" disabled />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="editGroupName" />
        </el-form-item>
        <el-form-item label="完整 JSON">
          <el-input v-model="editGroupFullJson" type="textarea" :rows="6" placeholder='若填写则优先整段作为请求体（须含 Id）' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgGroupEdit = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitUpdateGroup">提交</el-button>
      </template>
    </el-dialog>

    <!-- 新建资产 -->
    <el-dialog v-model="dlgAssetCreate" title="CreateAsset" width="520px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item label="GroupId" required>
          <el-input v-model="formAssetGroupId" placeholder="资产组 Id" />
        </el-form-item>
        <el-form-item label="Name" required>
          <el-input v-model="formAssetName" />
        </el-form-item>
        <el-form-item label="AssetType">
          <el-select v-model="formAssetType" style="width: 100%">
            <el-option label="Image" value="Image" />
            <el-option label="Video" value="Video" />
            <el-option label="Audio" value="Audio" />
          </el-select>
        </el-form-item>
        <el-form-item label="model">
          <el-input v-model="formAssetModel" placeholder="视频建议 volc-asset-video；音频 volc-asset-audio；图片可空" clearable />
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="formAssetUrl" type="textarea" :rows="2" placeholder="公网 URL / data:image/...;base64,..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgAssetCreate = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitCreateAsset">提交</el-button>
      </template>
    </el-dialog>

    <!-- 编辑资产 -->
    <el-dialog v-model="dlgAssetEdit" title="UpdateAsset" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="Id" required>
          <el-input v-model="editAssetId" disabled />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="editAssetName" />
        </el-form-item>
        <el-form-item label="完整 JSON">
          <el-input v-model="editAssetFullJson" type="textarea" :rows="6" placeholder="若填写则整段作为请求体（须含 Id）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgAssetEdit = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitUpdateAsset">提交</el-button>
      </template>
    </el-dialog>

    <!-- 详情 JSON -->
    <el-dialog v-model="dlgDetail" title="详情" width="640px" destroy-on-close>
      <el-input :model-value="detailJson" type="textarea" :rows="16" readonly class="mono" />
      <template #footer>
        <el-button type="primary" @click="dlgDetail = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { aiAPI } from '@/api/ai'

const props = defineProps({
  /** AI 配置列表（与 AI 配置页同源），用于一键填入 Base / Key */
  configs: { type: Array, default: () => [] },
})

const emit = defineEmits(['saved'])

const baseUrl = ref('')
/** OpenAPI 可选查询参数 ProjectName（与控制台项目对应，便于 IAM 精确到 project/某工程 而非 project/*） */
const projectName = ref('')
const accessKeyId = ref('')
const secretAccessKey = ref('')
const savedConfigId = ref(null)
const savingConfig = ref(false)
/** 创作页 SD2 认证默认写入的资产组 */
const assetGroupIdForCert = ref('')
const loadingGroups = ref(false)
const loadingAssets = ref(false)
const dlgLoading = ref(false)
const lastRawJson = ref('')
const assetGroupIdInput = ref('')
const lastListGroupsPayload = ref(null)
const lastListAssetsPayload = ref(null)

const dlgGroupCreate = ref(false)
const formGroupName = ref('')
const formGroupExtraJson = ref('')

const dlgGroupEdit = ref(false)
const editGroupId = ref('')
const editGroupName = ref('')
const editGroupFullJson = ref('')

const dlgAssetCreate = ref(false)
const formAssetGroupId = ref('')
const formAssetName = ref('')
const formAssetType = ref('Image')
const formAssetModel = ref('')
const formAssetUrl = ref('')

const dlgAssetEdit = ref(false)
const editAssetId = ref('')
const editAssetName = ref('')
const editAssetFullJson = ref('')

const dlgDetail = ref(false)
const detailJson = ref('')

const savedModelArkConfigs = computed(() => {
  return (props.configs || []).filter((c) => c.service_type === 'model_ark_asset')
})

function parseSettingsJson(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function loadFromSavedRow(row) {
  if (!row) return
  savedConfigId.value = row.id
  baseUrl.value = (row.base_url || '').replace(/\/$/, '')
  const s = parseSettingsJson(row.settings)
  projectName.value = s.project_name || ''
  assetGroupIdForCert.value = s.asset_group_id || ''
  accessKeyId.value = s.access_key_id || ''
  secretAccessKey.value = s.secret_access_key || ''
  if (assetGroupIdForCert.value) assetGroupIdInput.value = assetGroupIdForCert.value
}

function applyDefaultSavedConfig() {
  const rows = savedModelArkConfigs.value
  if (!rows.length) return
  const pick = rows.find((c) => c.is_default) || rows[0]
  loadFromSavedRow(pick)
}

watch(
  () => props.configs,
  () => {
    if (!savedConfigId.value) applyDefaultSavedConfig()
    else {
      const row = (props.configs || []).find((c) => c.id === savedConfigId.value)
      if (row) loadFromSavedRow(row)
    }
  },
  { immediate: true }
)

onMounted(() => {
  applyDefaultSavedConfig()
})

/**
 * 保证「默认资产组 Id」有值：已填则原样返回；留空则调用 CreateAssetGroup
 * 自动创建一个 AIGC 资产组，回填到字段并刷新左侧列表。
 * 失败（接口报错或没返回 Id）时抛出错误，由调用方决定如何提示。
 */
async function ensureAssetGroupId() {
  const existing = assetGroupIdForCert.value.trim()
  if (existing) return existing

  // 组名优先用 ProjectName，保持与控制台项目一致；为空则用固定默认名
  const name = projectName.value.trim() || 'sd2-default'
  const payload = { Name: name, GroupType: 'AIGC' }
  const resp = await call('CreateAssetGroup', payload)
  setLastJson(resp)

  // CreateAssetGroup 返回单个对象（非列表），与后端 pickId 取值口径一致
  const result = (resp && (resp.Result || resp.result)) || resp
  const groupId = String(
    result?.Id || result?.id || result?.GroupId || result?.group_id || ''
  ).trim()
  if (!groupId) {
    throw new Error('CreateAssetGroup 未返回组 Id（请查看下方调试响应）')
  }

  assetGroupIdForCert.value = groupId
  assetGroupIdInput.value = groupId
  // 刷新左侧资产组列表，让用户直观看到新建的组
  refreshGroups().catch(() => {})
  return groupId
}

async function saveToAiConfig() {
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || '请先完成连接信息')
    return
  }
  // 资产组 Id 留空时自动创建并回填，用户无需手填
  if (!assetGroupIdForCert.value.trim()) {
    ElMessage.info('未填写资产组 Id，正在自动创建...')
    try {
      await ensureAssetGroupId()
    } catch (e) {
      ElMessage.error('自动创建资产组失败：' + (e?.message || e))
      return
    }
  }
  const settings = {
    project_name: projectName.value.trim(),
    asset_group_id: assetGroupIdForCert.value.trim(),
    access_key_id: accessKeyId.value.trim(),
    secret_access_key: secretAccessKey.value.trim(),
  }
  const payload = {
    service_type: 'model_ark_asset',
    name: 'SD2 资产库',
    provider: 'model_ark',
    base_url: baseUrl.value.trim(),
    api_key: '',
    model: ['-'],
    default_model: '-',
    priority: 10,
    is_default: true,
    settings: JSON.stringify(settings),
  }
  savingConfig.value = true
  try {
    if (savedConfigId.value) {
      await aiAPI.update(savedConfigId.value, payload)
      ElMessage.success('已更新 AI 配置')
    } else {
      const created = await aiAPI.create(payload)
      savedConfigId.value = created?.id ?? null
      ElMessage.success('已保存到 AI 配置')
    }
    emit('saved')
  } catch (_) {
    /* request 已统一报错 */
  } finally {
    savingConfig.value = false
  }
}

function setLastJson(obj) {
  try {
    lastRawJson.value = JSON.stringify(obj, null, 2)
  } catch (_) {
    lastRawJson.value = String(obj)
  }
}

function extractRows(resp) {
  if (!resp) return []
  if (Array.isArray(resp)) return resp
  const keys = [
    'Items',
    'List',
    'AssetGroups',
    'Assets',
    'Groups',
    'Data',
  ]
  for (const k of keys) {
    if (Array.isArray(resp[k])) return resp[k]
  }
  const r = resp.Result || resp.result
  if (r && typeof r === 'object') {
    for (const k of keys) {
      if (Array.isArray(r[k])) return r[k]
    }
  }
  return []
}

const groupRows = computed(() => extractRows(lastListGroupsPayload.value))
const assetRows = computed(() => extractRows(lastListAssetsPayload.value))

function onGroupRowChange(row) {
  if (row && row.Id) {
    assetGroupIdInput.value = row.Id
    if (!assetGroupIdForCert.value.trim()) assetGroupIdForCert.value = row.Id
  }
}

function connReady() {
  return !!(baseUrl.value.trim() && accessKeyId.value.trim() && secretAccessKey.value.trim())
}

function connWarn() {
  if (!baseUrl.value.trim()) return '请先填写 Base URL'
  if (!accessKeyId.value.trim() || !secretAccessKey.value.trim()) {
    return '请填写 Access Key ID 与 Secret Access Key（控制台 IAM 访问密钥，非推理 API Key）'
  }
  return ''
}

/** 统一调用 ModelArk 资产管理 OpenAPI 代理；固定使用 AK/SK 签名 + 官方 Query 路径模式 */
async function call(action, payload) {
  const body = {
    base_url: baseUrl.value.trim(),
    action,
    path_mode: 'open_api_query',
    api_version: '2024-01-01',
    auth_mode: 'volc_sign',
    payload: payload || {},
  }
  if (projectName.value.trim()) body.project_name = projectName.value.trim()
  body.access_key_id = accessKeyId.value.trim()
  body.secret_access_key = secretAccessKey.value.trim()
  return aiAPI.modelArkAsset(body)
}

async function refreshGroups() {
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || '请先完成连接信息')
    return
  }
  loadingGroups.value = true
  try {
    const body = {
      PageNumber: 1,
      PageSize: 50,
      /** Filter、Filter.GroupType 均为官方 ListAssetGroups 必填；AIGC 为私有资产库常用类型 */
      Filter: {
        GroupType: 'AIGC',
      },
    }
    const data = await call('ListAssetGroups', body)
    lastListGroupsPayload.value = data
    setLastJson(data)
  } catch (e) {
    lastListGroupsPayload.value = null
  } finally {
    loadingGroups.value = false
  }
}

async function refreshAssets() {
  const gid = assetGroupIdInput.value.trim()
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || '请先完成连接信息')
    return
  }
  if (!gid) {
    ElMessage.warning('请填写或选择资产组 Id')
    return
  }
  loadingAssets.value = true
  try {
    const body = {
      PageNumber: 1,
      PageSize: 50,
      Filter: {
        GroupType: 'AIGC',
        GroupIds: [gid],
      },
    }
    const data = await call('ListAssets', body)
    lastListAssetsPayload.value = data
    setLastJson(data)
  } catch (e) {
    lastListAssetsPayload.value = null
  } finally {
    loadingAssets.value = false
  }
}

function openCreateGroup() {
  formGroupName.value = ''
  formGroupExtraJson.value = ''
  dlgGroupCreate.value = true
}

async function submitCreateGroup() {
  if (!formGroupName.value.trim()) {
    ElMessage.warning('请填写 Name')
    return
  }
  dlgLoading.value = true
  try {
    let extra = {}
    if (formGroupExtraJson.value.trim()) {
      try {
        extra = JSON.parse(formGroupExtraJson.value)
      } catch (_) {
        ElMessage.error('扩展 JSON 格式无效')
        return
      }
    }
    const payload = { Name: formGroupName.value.trim(), ...extra }
    const data = await call('CreateAssetGroup', payload)
    setLastJson(data)
    ElMessage.success('已创建')
    dlgGroupCreate.value = false
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

async function getGroupDetail(row) {
  dlgLoading.value = true
  try {
    const data = await call('GetAssetGroup', { Id: row.Id })
    detailJson.value = JSON.stringify(data, null, 2)
    dlgDetail.value = true
    setLastJson(data)
  } finally {
    dlgLoading.value = false
  }
}

function openEditGroup(row) {
  editGroupId.value = row.Id
  editGroupName.value = row.Name || ''
  editGroupFullJson.value = ''
  dlgGroupEdit.value = true
}

async function submitUpdateGroup() {
  dlgLoading.value = true
  try {
    let payload
    if (editGroupFullJson.value.trim()) {
      try {
        payload = JSON.parse(editGroupFullJson.value)
      } catch (_) {
        ElMessage.error('完整 JSON 无效')
        return
      }
    } else {
      payload = { Id: editGroupId.value, Name: editGroupName.value }
    }
    const data = await call('UpdateAssetGroup', payload)
    setLastJson(data)
    ElMessage.success('已更新')
    dlgGroupEdit.value = false
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

async function deleteGroup(row) {
  try {
    await ElMessageBox.confirm(`确定删除资产组「${row.Name || row.Id}」？`, 'DeleteAssetGroup', {
      type: 'warning',
    })
  } catch (_) {
    return
  }
  dlgLoading.value = true
  try {
    const data = await call('DeleteAssetGroup', { Id: row.Id })
    setLastJson(data)
    ElMessage.success('已删除')
    if (assetGroupIdInput.value === row.Id) assetGroupIdInput.value = ''
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

function openCreateAsset() {
  formAssetGroupId.value = assetGroupIdInput.value.trim()
  formAssetName.value = ''
  formAssetType.value = 'Image'
  formAssetModel.value = ''
  formAssetUrl.value = ''
  dlgAssetCreate.value = true
}

async function submitCreateAsset() {
  if (!formAssetGroupId.value.trim() || !formAssetName.value.trim()) {
    ElMessage.warning('请填写 GroupId 与 Name')
    return
  }
  dlgLoading.value = true
  try {
    const payload = {
      GroupId: formAssetGroupId.value.trim(),
      Name: formAssetName.value.trim(),
      AssetType: formAssetType.value,
    }
    if (formAssetUrl.value.trim()) payload.URL = formAssetUrl.value.trim()
    if (formAssetModel.value.trim()) payload.model = formAssetModel.value.trim()
    const data = await call('CreateAsset', payload)
    setLastJson(data)
    ElMessage.success('已创建')
    dlgAssetCreate.value = false
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}

async function getAssetDetail(row) {
  dlgLoading.value = true
  try {
    const data = await call('GetAsset', { Id: row.Id })
    detailJson.value = JSON.stringify(data, null, 2)
    dlgDetail.value = true
    setLastJson(data)
  } finally {
    dlgLoading.value = false
  }
}

function openEditAsset(row) {
  editAssetId.value = row.Id
  editAssetName.value = row.Name || ''
  editAssetFullJson.value = ''
  dlgAssetEdit.value = true
}

async function submitUpdateAsset() {
  dlgLoading.value = true
  try {
    let payload
    if (editAssetFullJson.value.trim()) {
      try {
        payload = JSON.parse(editAssetFullJson.value)
      } catch (_) {
        ElMessage.error('完整 JSON 无效')
        return
      }
    } else {
      payload = { Id: editAssetId.value, Name: editAssetName.value }
    }
    const data = await call('UpdateAsset', payload)
    setLastJson(data)
    ElMessage.success('已更新')
    dlgAssetEdit.value = false
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}

async function deleteAsset(row) {
  try {
    await ElMessageBox.confirm(`确定删除资产「${row.Name || row.Id}」？`, 'DeleteAsset', { type: 'warning' })
  } catch (_) {
    return
  }
  dlgLoading.value = true
  try {
    const data = await call('DeleteAsset', { Id: row.Id })
    setLastJson(data)
    ElMessage.success('已删除')
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}
</script>

<style scoped>
.sd2-asset-mgmt {
  max-width: 1100px;
}
.sd2-intro {
  margin-bottom: 14px;
}
.sd2-intro code {
  font-size: 12px;
}
.sd2-form {
  margin-bottom: 8px;
  max-width: 720px;
}
.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.field-hint code {
  font-size: 11px;
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.panel-actions.row-gap {
  flex-wrap: nowrap;
}
.mono :deep(textarea) {
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
}
.sd2-save-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.sd2-saved-hint {
  font-size: 12px;
  color: #67c23a;
  line-height: 1.5;
}
</style>
