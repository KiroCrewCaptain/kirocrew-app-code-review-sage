// The draft review this run staged, and the hand-off that publishes it.
//
// The built-in published the pending review from the app (Approve / Request
// changes / Comment) through the dashboard's own pull-request review endpoints.
// An installed app cannot reach those (PORTING.md, "Remaining gaps"), so the
// panel now says a draft is waiting and links to the pull request, where GitHub
// publishes it. What carries over is the gate: the panel appears only on this
// run's delivery evidence, never because a review merely finished.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DraftReviewActions from '../src/components/DraftReviewActions'

const PR_URL = 'https://github.com/acme/widgets/pull/12'

describe('DraftReviewActions', () => {
  it('says nothing when this run delivered no draft', () => {
    const { container } = render(<DraftReviewActions url={PR_URL} draftDelivered={false} />)
    expect(container.textContent).toBe('')
  })

  it('names the pending draft and links to the pull request to publish it', () => {
    render(<DraftReviewActions url={PR_URL} draftDelivered expectedReviewId="4242" />)
    expect(screen.getByText('Draft review')).toBeTruthy()
    expect(screen.getByText(/only you can see it until you publish/i)).toBeTruthy()
    const link = screen.getByRole('link', { name: /Open on GitHub/ })
    expect(link.getAttribute('href')).toBe(PR_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })

  it('offers no verdict of its own', () => {
    render(<DraftReviewActions url={PR_URL} draftDelivered />)
    for (const name of ['Submit as comment', 'Request changes', 'Approve']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('refuses a URL that is not http(s), since it lands in an href', () => {
    const { container } = render(
      <DraftReviewActions url="javascript:alert(1)" draftDelivered />,
    )
    expect(container.textContent).toBe('')
  })
})
