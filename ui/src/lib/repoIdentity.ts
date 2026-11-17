import type { RepoIdentity } from './types'

const PUBLIC_GITHUB_HOST = 'github.com'

export function repoHost(repo: RepoIdentity): string {
  const host = String(repo.host || PUBLIC_GITHUB_HOST).trim().toLowerCase()
  return host === 'www.github.com' ? PUBLIC_GITHUB_HOST : host
}

export function repoSlug(repo: RepoIdentity): string {
  const path = `${repo.owner}/${repo.repo}`
  const host = repoHost(repo)
  return host === PUBLIC_GITHUB_HOST ? path : `${host}/${path}`
}

export function repoKey(repo: RepoIdentity): string {
  return repoSlug(repo).toLowerCase()
}

export function repoUrl(repo: RepoIdentity): string {
  return `https://${repoHost(repo)}/${repo.owner}/${repo.repo}`
}

export function sameRepo(left: RepoIdentity, right: RepoIdentity): boolean {
  return repoKey(left) === repoKey(right)
}
