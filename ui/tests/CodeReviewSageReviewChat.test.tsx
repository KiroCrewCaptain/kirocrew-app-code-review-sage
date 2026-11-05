// Follow-up on a review: the panel's state contract.
//
// What matters here is not pixels but the two states the backend can be in, and
// that the UI never lies about which one it is. A follow-up resumes the reviewer's
// own session from disk, so:
//
//   * RESUMABLE     -> a button, because reopening would restore the reasoning.
//   * NOT RESUMABLE -> NO button and an explanation, because a session opened
//                      without that context answers confidently about a review it
//                      knows nothing about.
//
// It also pins the continue sequence (this app re-arms the resume, then the host's
// chat launcher opens the existing slot), that a NEW session is not offered (the
// built-in created it through the dashboard's `POST /api/chat/slots`, which an
// installed app cannot reach; PORTING.md), and that a backend error is rendered
// from the catalog via its `code` -- never as the server's English prose, which
// would land untranslated inside a localized page.
//
// And it pins who gets markdown in the stored history: the reviewer's answers do
// (it writes markdown), the user's own words and the raw reasoning dump do not
// (rendering those would show text nobody wrote).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import type { ChatState, ChatTurn } from '../src/lib/types'

const chatState = vi.fn()
const followupStart = vi.fn()

class FakeSageApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

vi.mock('../src/api', () => ({
  sageApi: {
    chatState: (...a: unknown[]) => chatState(...a),
    followupStart: (...a: unknown[]) => followupStart(...a),
  },
  SageApiError: FakeSageApiError,
}))

import { stubOpenChat as openChat } from './stubs/app-sdk'

const ReviewChat = (await import(
  '../src/components/ReviewChat')).default

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
  return {
    role: 'reviewer',
    text: 'Because the caller retries on failure.',
    thinking: '',
    tools: [],
    refusals: [],
    ts: 1,
    ...over,
  }
}

function state(over: Partial<ChatState> = {}): ChatState {
  return {
    run_id: 'r1',
    change_id: 'c1',
    turns: [],
    resumable: true,
    reason: '',
    slot_key: 'sage-followup-abc123def456',
    followup_open: false,
    ...over,
  }
}

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ReviewChat runId="r1" changeId="c1" />
    </QueryClientProvider>,
  )
}

async function expand() {
  mount()
  fireEvent.click(screen.getByRole('button', { name: /ask the reviewer/i }))
  await waitFor(() => expect(chatState).toHaveBeenCalled())
}

describe('ReviewChat', () => {
  beforeEach(() => {
    chatState.mockReset()
    followupStart.mockReset()
  })

  it('is collapsed until asked for, and fetches nothing while collapsed', () => {
    chatState.mockResolvedValue(state())
    mount()
    // Most reports are read without questions; the findings are the substance.
    expect(chatState).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /follow-up session/i })).toBeNull()
  })

  it('says a new session cannot be opened from the app yet, and offers no button', async () => {
    // Resumable, but no session exists: creating one needs the dashboard's slot
    // endpoint, which an installed app cannot call. A button here would open a
    // session that knows nothing about the review.
    chatState.mockResolvedValue(state())
    await expand()
    await waitFor(() => expect(
      screen.getByText(/cannot be opened from this app yet/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /follow-up session/i })).toBeNull()
  })

  it('offers nothing when the review kept no session', async () => {
    chatState.mockResolvedValue(state({
      resumable: false, reason: 'followup_not_recorded',
    }))
    await expand()
    await waitFor(() => expect(
      screen.getByText(/did not keep a reviewer session/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /open a follow-up session/i })).toBeNull()
  })

  it('distinguishes a lost transcript from one never kept', async () => {
    // Different causes, different remedies — collapsing them into one message
    // would tell a user to re-run a review that did run.
    chatState.mockResolvedValue(state({
      resumable: false, reason: 'followup_transcript_gone',
    }))
    await expand()
    await waitFor(() => expect(
      screen.getByText(/no longer on disk/i)).toBeTruthy())
    expect(screen.queryByText(/did not keep a reviewer session/i)).toBeNull()
  })

  it('offers nothing while the review is still running', async () => {
    // A first pass can be superseded by a second one in the same run, which
    // retires the descriptor — so a conversation opened mid-run would end up
    // pointing at findings the run replaced.
    chatState.mockResolvedValue(state({
      resumable: false, reason: 'followup_run_live',
    }))
    await expand()
    await waitFor(() => expect(
      screen.getByText(/still running/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /follow-up session/i })).toBeNull()
  })

  it('offers to CONTINUE when the conversation already exists', async () => {
    // A returning user must not be invited to "open" a conversation they already
    // had: the exchanges live in the Chat tab, so an "open" label reads as the
    // review having lost them.
    chatState.mockResolvedValue(state({ followup_open: true }))
    await expand()
    await waitFor(() => expect(screen.getByRole('button',
      { name: /continue the follow-up session/i })).toBeTruthy())
    expect(screen.getByText(/continues in the chat tab/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^open a follow-up session$/i }))
      .toBeNull()
  })

  it('re-arms the resume, then opens the existing slot through the host launcher', async () => {
    chatState.mockResolvedValue(state({ followup_open: true }))
    followupStart.mockResolvedValue({
      ok: true,
      slot_key: 'sage-followup-abc123def456',
      agent: 'sage-reviewer',
      folder_id: 'fold1',
      title: 'followup-pr#42-fix the thing',
    })
    await expand()
    fireEvent.click(await screen.findByRole('button',
      { name: /continue the follow-up session/i }))
    await waitFor(() => expect(followupStart).toHaveBeenCalledWith('r1', 'c1'))
    // Only the key: the session exists, so nothing about it is re-pinned (a title
    // or folder sent again would undo the user's own rename and filing).
    await waitFor(() => expect(openChat).toHaveBeenCalledWith(
      { slotKey: 'sage-followup-abc123def456' }))
  })

  it('does not open the slot when arming the resume is refused', async () => {
    // The order matters: a session opened for a resume that was refused has no
    // review context and no way to tell.
    chatState.mockResolvedValue(state({ followup_open: true }))
    followupStart.mockRejectedValue(
      new FakeSageApiError('the reviewer\'s session is no longer on disk',
        'followup_transcript_gone'))
    await expand()
    fireEvent.click(await screen.findByRole('button',
      { name: /continue the follow-up session/i }))
    await waitFor(() => expect(screen.getByText(/no longer on disk/i)).toBeTruthy())
    expect(openChat).not.toHaveBeenCalled()
  })

  it('renders a backend failure from its code, not the server prose', async () => {
    chatState.mockResolvedValue(state({ followup_open: true }))
    followupStart.mockRejectedValue(
      new FakeSageApiError('the review this belongs to was deleted',
        'chat_run_deleted'))
    await expand()
    fireEvent.click(await screen.findByRole('button',
      { name: /continue the follow-up session/i }))
    await waitFor(() => expect(
      screen.getByText(/this review was deleted/i)).toBeTruthy())
    // The English sentence Python produced must never reach a localized page.
    expect(screen.queryByText(/belongs to was deleted/i)).toBeNull()
  })

  it('names the action it failed at, not a question nobody asked', async () => {
    // A failure that is not a SageApiError lands on the generic string. The user
    // clicked a button and asked nothing, so copy about an unanswered question
    // would be actively misleading.
    chatState.mockResolvedValue(state({ followup_open: true }))
    followupStart.mockRejectedValue(new Error('network down'))
    await expand()
    fireEvent.click(await screen.findByRole('button',
      { name: /continue the follow-up session/i }))
    await waitFor(() => expect(
      screen.getByText(/session could not be opened/i)).toBeTruthy())
    expect(screen.queryByText(/question could not be answered/i)).toBeNull()
    expect(openChat).not.toHaveBeenCalled()
  })

  it('still shows what was discussed before follow-ups were sessions', async () => {
    chatState.mockResolvedValue(state({
      turns: [turn({ role: 'user', text: 'why?' }), turn()],
    }))
    await expand()
    await waitFor(() => expect(screen.getByText('why?')).toBeTruthy())
    expect(screen.getByText(/because the caller retries/i)).toBeTruthy()
    // Labelled, so it does not read as part of the session the button opens.
    expect(screen.getByText(/earlier questions/i)).toBeTruthy()
  })

  it('names the tools it looked at, inside the sentence', async () => {
    // The list is interpolated into the catalog string rather than concatenated
    // after a fragment, so this also pins that the placeholder actually resolves
    // instead of rendering a literal {{tools}}.
    chatState.mockResolvedValue(state({
      turns: [turn({ tools: ['Read useUpload.ts', 'Grep revokeObjectURL'] })],
    }))
    await expand()
    await waitFor(() => expect(
      screen.getByText(/Read useUpload\.ts, Grep revokeObjectURL/)).toBeTruthy())
    expect(screen.queryByText(/\{\{tools\}\}/)).toBeNull()
  })

  it('says so when an answer was limited by a refused tool', async () => {
    chatState.mockResolvedValue(state({
      turns: [turn({ refusals: ['run shell'] })],
    }))
    await expand()
    // A bounded answer must announce that it is bounded, or it reads as a
    // confident one.
    await waitFor(() => expect(
      screen.getByText(/this answer is limited/i)).toBeTruthy())
  })

  it('hides reasoning behind a disclosure rather than inlining it', async () => {
    chatState.mockResolvedValue(state({
      turns: [turn({ thinking: 'weighing the call sites' })],
    }))
    await expand()
    await waitFor(() => expect(
      screen.getByRole('button', { name: /reasoning/i })).toBeTruthy())
    expect(screen.queryByText(/weighing the call sites/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /reasoning/i }))
    expect(screen.getByText(/weighing the call sites/)).toBeTruthy()
  })

  it('hands the reviewer answer to the host markdown renderer', async () => {
    // The reviewer answers in markdown -- real answers carry fenced code,
    // `identifiers`, bold and numbered steps -- so its turns go through the host's
    // MarkdownRenderer (the stand-in marks what it was handed).
    const text = 'The **flock** serializes `pod up`.\n\n1. writes CHECKOUT\n2. merges'
    chatState.mockResolvedValue(state({ turns: [turn({ text })] }))
    await expand()
    await waitFor(() => expect(document.querySelector('[data-markdown]')).toBeTruthy())
    expect(document.querySelector('[data-markdown]')?.textContent).toBe(text)
  })

  it('echoes the user question verbatim, never as markdown', async () => {
    // Their own words, handed back. Reinterpreting them would show the user
    // something they did not type -- a question ABOUT `**kwargs` or a *glob*
    // must not come back bolded and italicized.
    const asked = 'Why does **kwargs break the *glob* pattern?'
    chatState.mockResolvedValue(state({
      turns: [turn({ role: 'user', text: asked })],
    }))
    await expand()
    await waitFor(() => expect(screen.getByText(asked)).toBeTruthy())
    expect(screen.getByText(asked).closest('[data-markdown]')).toBeNull()
  })
})
