/**
 * One branch label for every surface: the human name first, the short code in
 * brackets. Codes are identifiers; names are what people recognise.
 */
export interface BranchIdentity {
  name: string
  code: string
}

export function formatBranchLabel(branch: BranchIdentity | null | undefined): string {
  if (!branch) return '—'
  const name = branch.name.trim()
  const code = branch.code.trim()
  if (!name) return code || '—'
  if (!code) return name
  return `${name} (${code})`
}
