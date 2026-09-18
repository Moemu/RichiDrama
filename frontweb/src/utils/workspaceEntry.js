/**
 * Creation entry points shared by the header and every page that hosts them.
 * Keeping them here means the tab bar behaves identically wherever it renders
 * instead of relying on a page-level event handler.
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { creativeBoardAPI } from '@/api/creativeBoards'
import { omniVideoAPI } from '@/api/omniVideo'

export async function promptCreateCreativeBoard(router) {
  try {
    const answer = await ElMessageBox.prompt('为新画布取个名称', '新建纯画布', {
      inputValue: '未命名画布',
      inputPattern: /\S/,
      inputErrorMessage: '请输入画布名称',
    })
    const board = await creativeBoardAPI.create(answer.value)
    await router.push(`/creative-boards/${board.id}`)
    return board
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '画布创建失败')
    return null
  }
}

export async function startOmniProject(router) {
  try {
    const project = await omniVideoAPI.createSequence()
    await router.push({ path: '/free-create', query: { sequence_id: project.id } })
    return project
  } catch (error) {
    ElMessage.error(error.message || '创建全能创作项目失败')
    return null
  }
}
