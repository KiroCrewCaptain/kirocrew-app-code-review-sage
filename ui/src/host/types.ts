/**
 * The two dashboard types the page reads, restated: the provider payload of a
 * pull request (`types/index.sources.ts`, the fields the page reads) and the link
 * shape the dashboard's pull-request panel takes (`utils/pullRequestLinks.ts`).
 *
 * The payload comes from the dashboard's `/api/source/pull-request`, which this
 * app's manifest declares, through the host's scoped client (`sourceApi` in
 * `api.ts`); the link is what the App SDK's `PullRequestPanel` takes.
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
