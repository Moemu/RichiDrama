import { ElMessageBox } from 'element-plus'
import { hasUnsavedProjectText } from '@/composables/useProjectCollaboration'

export async function confirmProjectNavigation() {
  if (!hasUnsavedProjectText()) return true
  try {
    await ElMessageBox.confirm('还有未保存的文字或待恢复草稿。离开将放弃这些内容，建议留在页面等待保存。', '未保存修改', {
      confirmButtonText: '放弃修改并离开', cancelButtonText: '留在页面', type: 'warning',
      closeOnClickModal: false, autofocus: false,
    })
    return true
  } catch { return false }
}

export function warnBeforeProjectUnload(event) {
  if (!hasUnsavedProjectText()) return
  event.preventDefault()
  event.returnValue = ''
}
