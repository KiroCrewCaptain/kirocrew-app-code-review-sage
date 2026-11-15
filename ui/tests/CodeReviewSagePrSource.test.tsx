// The pull request's provider payload, the notices Sage wraps it in, and the
// status chips drawn from it.
//
// The chips and notices are pure given a PullRequestSource, so they are tested
// directly. The payload is read from the dashboard's `/api/source/pull-request`
// through the scoped client (the manifest declares it), keyed as the App SDK's
// `PullRequestPanel` keys its own read, so the header and the tab share one
// request.
import { i18next } from './stubs/i18n-all'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { PartialNote, SourceError, usePrSource } from '../src/components/PrSourcePanel'
import PrStatusChips from '../src/components/PrStatusChips'
import type { PullRequestSource } from '../src/host/types'

const URL_ = 'https://github.com/acme/widgets/pull/7'

function source(over: Partial<PullRequestSource> = {}): PullRequestSource {
  return {
    provider: 'github',
    url: URL_,
    number: 7,
    title: 'Tighten the cookie jar',
    description: 'Caps the jar so a big header cannot wedge the gateway.',
    state: 'open',
    draft: false,
    mergedAt: '',
    updatedAt: new Date().toISOString(),
    headBranch: 'fix/jar',
    baseBranch: 'main',
    headSha: 'abc1234',
    author: 'ann',
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    commits: [],
    checks: [
      {
        name: 'Lint', workflow: 'CI', status: 'completed',
        conclusion: 'success', bucket: 'passed', url: '',
        startedAt: '', completedAt: '',
      },
      {
        name: 'Backend Tests', workflow: 'CI', status: 'completed',
        conclusion: 'failure', bucket: 'failed', url: 'https://ci/1',
        startedAt: '', completedAt: '',
      },
    ],
    comments: [{
      id: 'c1', kind: 'comment', author: 'bob', body: 'Nice **fix**.',
      state: '', createdAt: new Date().toISOString(), url: '', path: '',
      line: null,
    }],
    files: [],
    ...over,
  }
}

describe('the provider payload', () => {
  it('is read once from the declared pull-request path, with the dashboard\'s body', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(source()), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(() => usePrSource(URL_), { wrapper })
      await waitFor(() => expect(result.current.data?.title).toBe('Tighten the cookie jar'))
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [path, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      expect(path).toBe('/api/source/pull-request')
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ url: URL_, refresh: false })
      // The SDK panel's own key, so the panel reuses this entry instead of
      // asking again.
      expect(qc.getQueryData(['pull-request-source', URL_])).toEqual(result.current.data)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the notices Sage wraps the provider payload in', () => {
  it('degrades to a note when the provider call fails', () => {
    // The review is the point of the pane; a failed context fetch must not
    // replace it with an error screen.
    render(<SourceError error={new Error('gh exploded')} />)
    expect(screen.getByText(/Could not load pull-request details/i)).toBeTruthy()
    expect(screen.getByText(/gh exploded/)).toBeTruthy()
  })

  it('flags incomplete sections instead of implying completeness', () => {
    render(<PartialNote src={source({ partialSections: ['comments'] })} />)
    expect(screen.getByText(/Some sections are incomplete/i)).toBeTruthy()
  })

  it('says nothing when every section came back whole', () => {
    const { container } = render(<PartialNote src={source()} />)
    expect(container.textContent).toBe('')
  })
})

describe('the pull request\'s own status', () => {
  const check = (bucket: string, name: string) => ({
    name, workflow: 'ci', bucket, status: 'completed', conclusion: bucket, url: '',
  })

  it('says a pull request is open', () => {
    render(<PrStatusChips src={source()} />)
    expect(screen.getByText('open')).toBeTruthy()
  })

  it('says merged, whatever the provider calls the state', () => {
    // GitHub reports a merged PR's state as CLOSED, so mergedAt is the signal.
    render(<PrStatusChips src={source({ state: 'closed', mergedAt: '2026-07-01T00:00:00Z' })} />)
    expect(screen.getByText('merged')).toBeTruthy()
    expect(screen.queryByText('closed')).toBeNull()
  })

  it('distinguishes closed-without-merging', () => {
    render(<PrStatusChips src={source({ state: 'closed', mergedAt: '' })} />)
    expect(screen.getByText('closed')).toBeTruthy()
  })

  it('flags conflicts', () => {
    render(<PrStatusChips src={source({ mergeable: 'conflicting' })} />)
    expect(screen.getByText('conflicts')).toBeTruthy()
  })

  it('stays quiet when a PR merges cleanly', () => {
    // "Mergeable" is the expected case; saying so on every PR is noise.
    render(<PrStatusChips src={source({ mergeable: 'mergeable' })} />)
    expect(screen.queryByText(/conflicts|merge blocked/)).toBeNull()
  })

  it('leads with failing checks', () => {
    render(<PrStatusChips src={source({
      checks: [check('failed', 'a'), check('pending', 'b'), check('passed', 'c')],
    })} />)
    // A failure is what stops the PR, so it beats the pending count.
    expect(screen.getByText('1 failing')).toBeTruthy()
    expect(screen.queryByText(/running/)).toBeNull()
  })

  it('reports checks still running when none failed', () => {
    render(<PrStatusChips src={source({
      checks: [check('pending', 'a'), check('passed', 'b')],
    })} />)
    expect(screen.getByText('1 running')).toBeTruthy()
  })

  it('reports a green run', () => {
    render(<PrStatusChips src={source({
      checks: [check('passed', 'a'), check('passed', 'b')],
    })} />)
    expect(screen.getByText('2 passed')).toBeTruthy()
  })

  it('counts failing, running and passed checks in the interface language', async () => {
    await i18next.changeLanguage('de')
    try {
      const { unmount } = render(<PrStatusChips src={source({ checks: [check('pending', 'a'), check('passed', 'b')] })} />)
      expect(screen.getByText('1 läuft')).toBeTruthy()
      unmount()
      const second = render(<PrStatusChips src={source({ checks: [check('passed', 'a'), check('passed', 'b')] })} />)
      expect(screen.getByText('2 bestanden')).toBeTruthy()
      second.unmount()
      render(<PrStatusChips src={source({ checks: [check('failed', 'a'), check('failed', 'b')] })} />)
      expect(screen.getByText('2 fehlgeschlagen')).toBeTruthy()
    } finally {
      await i18next.changeLanguage('en')
    }
  })

  it('shows no check chip when the provider reported none', () => {
    render(<PrStatusChips src={source({ checks: [] })} />)
    expect(screen.queryByText(/passed|failing|running/)).toBeNull()
  })

  it('renders nothing before the provider call lands', () => {
    // Placeholders would imply a status we do not know yet.
    const { container } = render(<PrStatusChips src={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
