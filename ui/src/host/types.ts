/**
 * The two dashboard types the page reads, restated: the provider payload of a
 * pull request (`types/index.sources.ts`, the fields the page reads) and the link
 * shape the dashboard's pull-request panel takes (`utils/pullRequestLinks.ts`).
 *
 * Neither is fetched or rendered by the dashboard for this app: the payload comes
 * from the dashboard's `/api/source/pull-request`, which is outside this app's API
 * grant (PORTING.md, "Remaining gaps"), so `usePrSource` never has one and every
 * reader treats it as absent.
 */

export type PullRequestProvider = 'github' | 'gitlab' | 'bitbucket-server' | (string & {})

export interface PullRequestLink {
  url: string
  provider: PullRequestProvider
  number: number
  repo: string
  kind: 'change' | 'issue'
}

export interface PullRequestCheck {
  name?: string
  bucket?: string
}

export interface PullRequestSource {
  provider: PullRequestProvider
  url: string
  number: number
  title: string
  state: string
  draft: boolean
  mergedAt: string
  updatedAt: string
  headSha: string
  author: string
  mergeable?: string
  mergeStateStatus?: string
  checks: PullRequestCheck[]
  partialSections?: string[]
}
