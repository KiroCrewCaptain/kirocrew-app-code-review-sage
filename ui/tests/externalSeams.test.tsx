/**
 * What changed when the page left the dashboard: its own string catalogs, the
 * host's scoped client as the transport (and the backend's `code` read back out
 * of its refusal), the bundle's own stand-ins for dashboard internals (the menu,
 * the dialog focus trap), and the fallbacks for a host older than App Kit level 1.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CATALOGS, localeChain, t } from '../src/i18n'
import { SageApiError, sageApi, setTransport } from '../src/api'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../src/host/DropdownMenu'
import { useDialogFocusTrap } from '../src/host/useDialogFocusTrap'
import { stubLocale } from './stubs/app-sdk'

const SRC = join(__dirname, '..', 'src')
const I18N = join(__dirname, '..', 'i18n')

function flatten(node: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('the string catalogs', () => {
  it('ships every dashboard locale with the same keys as English', () => {
    const files = readdirSync(I18N).filter(f => f.endsWith('.json')).sort()
    expect(files).toEqual(['bn', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'zh-CN'].map(l => `${l}.json`))
    // A plural key carries the forms ITS locale names (`_many` in es, none but
    // `_other` in ja), so keys are compared without the plural suffix.
    const base = (keys: string[]) =>
      [...new Set(keys.map(k => k.replace(/_(zero|one|two|few|many|other)$/, '')))].sort()
    const english = base(flatten(CATALOGS.en as Record<string, unknown>))
    for (const locale of Object.keys(CATALOGS)) {
      expect(base(flatten(CATALOGS[locale] as Record<string, unknown>)), locale).toEqual(english)
    }
  })

  it('has a string for every literal key the page names', () => {
    const keys = new Set<string>()
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf-8')
      for (const m of text.matchAll(/'((?:apps|app|components|lib)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g)) {
        keys.add(m[1])
      }
    }
    expect(keys.size).toBeGreaterThan(300)
    const missing = [...keys].filter(k => t(k) === k && t(k, { count: 2 }) === k)
    expect(missing).toEqual([])
  })

  it('falls back from a regional locale to its language, then to English', () => {
    expect(localeChain('pt-BR')).toEqual(['pt', 'en'])
    expect(localeChain('zh-CN')).toEqual(['zh-CN', 'en'])
    expect(localeChain('xx')).toEqual(['en'])
    stubLocale('de')
    expect(t('apps.codeReviewSage.components.reviewChat.title')).toBe(
      (CATALOGS.de as { apps: { codeReviewSage: { components: { reviewChat: { title: string } } } } })
        .apps.codeReviewSage.components.reviewChat.title,
    )
  })

  it('carries the listing copy the manifest names, per locale', () => {
    for (const locale of Object.keys(CATALOGS)) {
      const manifest = (CATALOGS[locale] as { apps: { codeReviewSage: { manifest: Record<string, string> } } })
        .apps.codeReviewSage.manifest
      expect(manifest.display_name, locale).toBeTruthy()
      expect(manifest.description, locale).toBeTruthy()
    }
  })
})

describe('the transport', () => {
  afterEach(() => setTransport(null))

  it('routes every call through the scoped client under the granted prefix', async () => {
    const raw = vi.fn(async () => new Response(JSON.stringify({ runs: [] }), { status: 200 }))
    setTransport({ raw })
    await sageApi.runs()
    await sageApi.cancelRun('r1')
    await sageApi.putSettings({ effort: 'high' })
    expect(raw.mock.calls.map(c => [c[0], (c[1] as RequestInit).method ?? 'GET'])).toEqual([
      ['/api/apps/code-review-sage/runs', 'GET'],
      ['/api/apps/code-review-sage/runs/r1/cancel', 'POST'],
      ['/api/apps/code-review-sage/settings', 'PUT'],
    ])
  })

  it('reads the backend code back out of the scoped client refusal', async () => {
    const raw = vi.fn(async () => {
      throw Object.assign(new Error('API 403: ...'), {
        status: 403,
        body: JSON.stringify({ code: 'owner_only', error: 'owner authorization required' }),
      })
    })
    setTransport({ raw })
    const err = await sageApi.review(['https://github.com/acme/widgets/pull/1']).catch(e => e)
    expect(err).toBeInstanceOf(SageApiError)
    expect(err.code).toBe('owner_only')
    expect(err.message).toBe('owner authorization required')
  })

  it('keeps the refused character a namespace refusal names', async () => {
    setTransport({
      raw: async () => {
        throw Object.assign(new Error('API 400'), {
          status: 400,
          body: JSON.stringify({ code: 'invalid_namespace_name', error: 'bad', char: 'О' }),
        })
      },
    })
    const err = await sageApi.createNamespace('Отчет').catch(e => e)
    expect(err.code).toBe('invalid_namespace_name')
    expect(err.char).toBe('О')
  })

  it('names a refusal with no JSON body by its status', async () => {
    setTransport({
      raw: async () => {
        throw Object.assign(new Error('API 404'), { status: 404, body: 'not found' })
      },
    })
    const err = await sageApi.run('gone').catch(e => e)
    expect(err).toBeInstanceOf(SageApiError)
    expect(err.message).toBe('HTTP 404')
    expect(err.code).toBe('')
  })
})

describe('the menu stand-in', () => {
  function Menu({ onPick }: { onPick: (v: string) => void }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Repos</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => onPick('a')}>alpha</DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onPick('b') }}>beta</DropdownMenuItem>
          <DropdownMenuItem disabled onSelect={() => onPick('c')}>gamma</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  it('opens from the keyboard and focuses the first item', () => {
    render(<Menu onPick={() => {}} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Repos' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('alpha')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('beta')
    // The disabled item is skipped.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('alpha')
  })

  it('closes on a selection unless the handler keeps it open', () => {
    const onPick = vi.fn()
    render(<Menu onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'Repos' })
    fireEvent.pointerDown(trigger, { button: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'beta' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'alpha' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onPick.mock.calls.map(c => c[0])).toEqual(['b', 'a'])
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Escape and on a press outside', () => {
    render(<><Menu onPick={() => {}} /><p>outside</p></>)
    const trigger = screen.getByRole('button', { name: 'Repos' })
    fireEvent.pointerDown(trigger, { button: 0 })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.pointerDown(trigger, { button: 0 })
    fireEvent.pointerDown(screen.getByText('outside'), { button: 0 })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ignores a secondary press, as the dashboard menu does', () => {
    render(<Menu onPick={() => {}} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Repos' }), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('the dialog focus trap stand-in', () => {
  function Dialog({ onClose }: { onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    useDialogFocusTrap(ref, onClose)
    return (
      <div ref={ref} role="dialog">
        <button type="button">first</button>
        <button type="button">last</button>
      </div>
    )
  }

  it('focuses the first control, wraps Tab, and closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)
    expect(document.activeElement?.textContent).toBe('first')
    screen.getByRole('button', { name: 'last' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('first')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('a host before App Kit level 1', () => {
  it('falls back to a native select and no guide marker', async () => {
    vi.resetModules()
    vi.doMock('@kirocrew/app-sdk/ui', () => ({ ErrorNotice: () => null }))
    const sdk = await import('../src/hostSdk')
    const NativeSelect = (await import('../src/NativeSelect')).default
    expect(sdk.Select).toBe(NativeSelect)
    expect(sdk.guideCaution).toEqual({})
    vi.doUnmock('@kirocrew/app-sdk/ui')
    vi.resetModules()
  })

  it('uses the host Select and guide marker when they exist', async () => {
    const sdk = await import('../src/hostSdk')
    const ui = await import('@kirocrew/app-sdk/ui')
    expect(sdk.Select).toBe((ui as { Select: unknown }).Select)
    expect(sdk.guideCaution).toEqual({ 'data-guide-caution': '' })
  })
})
