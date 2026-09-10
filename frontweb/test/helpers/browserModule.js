import { readFile } from 'node:fs/promises'

export const moduleSourceUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

export async function browserModuleUrl(path, imports) {
  let source = await readFile(path, 'utf8')
  for (const [specifier, replacement] of Object.entries(imports)) {
    source = source.replaceAll(`'${specifier}'`, `'${replacement}'`)
  }
  return moduleSourceUrl(source)
}
