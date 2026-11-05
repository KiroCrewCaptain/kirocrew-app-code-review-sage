// Code Review Sage — page entry point.
//
// The page itself is deliberately thin: it resolves an optional deep-linked run
// (`?run=<run_id>`) and mounts the provider + shell. All state lives in
// `context.tsx`.
import { useState } from 'react'

import Workspace from './Workspace'
import AddReposModal from './components/AddReposModal'
import { SageProvider, useSage } from './context'

export default function CodeReviewSagePage() {
  // Read once for the initial selection only. Keeping this uncontrolled after
  // mount means clicking through threads doesn't fight the URL, and a stale query
  // param can never yank the user back to an older review. Read off the location
  // rather than the dashboard's router, which an app bundle has no handle on.
  const [initialRunId] = useState(
    () => new URLSearchParams(window.location.search).get('run'),
  )

  return (
    // `relative` so the modal's `absolute inset-0` backdrop covers the app area
    // rather than the whole Kiro Crew window — the workspace blurs behind it.
    <div className="relative h-full">
      <SageProvider initialRunId={initialRunId}>
        <Workspace />
        <AddReposLayer />
      </SageProvider>
    </div>
  )
}

/** Mounts the add-repos dialog when the rail asks for it. Separate component so
 *  it can read the provider it sits inside. */
function AddReposLayer() {
  const { addingRepos, closeAddRepos } = useSage()
  return addingRepos ? <AddReposModal onClose={closeAddRepos} /> : null
}
