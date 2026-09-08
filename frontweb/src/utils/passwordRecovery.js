export function newPasswordError(password, confirmation) {
  const length = Array.from(password).length
  if (length < 8 || length > 128) return '新密码需为 8–128 个字符'
  if (password !== confirmation) return '两次输入的密码不一致'
  return ''
}

export function clearPasswordSession() {
  localStorage.removeItem('lmd_auth_token')
  localStorage.removeItem('lmd_auth_user')
}
