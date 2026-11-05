// The draft review this run staged on the pull request, and where to publish it.
//
// The built-in published the pending review from here (Approve / Request changes
// / Comment) through the dashboard's own pull-request review endpoints, which
// bind the verdict to the draft's content digest. Those endpoints are outside
// this app's API grant and have no App Kit seam yet (PORTING.md, "Remaining
// gaps"), so this copy says that a draft is waiting and hands off to the pull
// request, where GitHub's own review form publishes it. It never claims a draft
// this run did not deliver: the built-in's delivery-evidence gate
// (`draftDelivered`) still decides whether it renders at all.
import { ExternalLink } from 'lucide-react'

import { i18nT } from '../i18n'
import { safeHttpUrl } from '../host/safeUrl'

export default function DraftReviewActions(
  { url, draftDelivered }: { url: string; draftDelivered: boolean; expectedReviewId?: string },
) {
  const href = safeHttpUrl(url)
  if (!draftDelivered || !href) return null
  return (
    <section className="rounded-md border border-border px-3 py-2.5 flex flex-col gap-1.5">
      <div className="text-[12.5px] font-medium text-text">
        {i18nT('apps.codeReviewSage.components.draftReviewActions.draft_review')}
      </div>
      <div className="text-[12px] leading-[1.6] text-muted">
        {i18nT('apps.codeReviewSage.components.draftReviewActions.pending_only_you_can_see_it_until_you_publish')}
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 text-[12.5px] text-accent hover:underline"
      >
        {i18nT('apps.codeReviewSage.components.prReviewDetail.open_on_github')}
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    </section>
  )
}
