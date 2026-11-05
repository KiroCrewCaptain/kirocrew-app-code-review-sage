// The pull request's provider payload.
//
// The built-in read it from the dashboard's own PR endpoint
// (`/api/source/pull-request`, the one the GitHub side panel uses) and rendered
// it in a "Pull request" tab with the dashboard's shared `PullRequestPanel`
// (description, checks, comments, diff, commits). The endpoint is outside this
// app's API grant and the panel is not part of the App SDK (PORTING.md,
// "Remaining gaps"), so this copy never fetches a payload: `usePrSource` is a
// disabled query that holds none, and every reader treats a missing payload as
// "not loaded" (the header falls back to the fields the pull-request list
// carries, and links to the pull request on GitHub). The query key is the
// built-in's, so a host that later hands the payload over fills the same entry.
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { PullRequestSource } from '../host/types'

/** The provider payload for one pull request: never fetched here (see above). */
export function usePrSource(url: string): UseQueryResult<PullRequestSource, Error> {
  return useQuery<PullRequestSource, Error>({
    queryKey: ['pull-request-source', url],
    queryFn: () => Promise.reject(new Error('no pull request payload for an app')),
    enabled: false,
  })
}
