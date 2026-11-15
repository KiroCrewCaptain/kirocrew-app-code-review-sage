/**
 * Host names added at App Kit level 1, feature-detected.
 *
 * A named import of an export the host's module does not have fails the whole
 * bundle at link time, so a host older than these seams would show a broken page
 * instead of a slightly plainer one. These names are therefore read off namespace
 * imports, each through an `in` check, and each has a local fallback. Names every
 * supported host has are named-imported where they are used.
 */

import * as sdk from '@kirocrew/app-sdk'
import * as ui from '@kirocrew/app-sdk/ui'
import NativeSelect from './NativeSelect'

/** The host's inline dropdown, or a native `<select>` on a host without one. */
export const Select = ('Select' in ui ? ui.Select : undefined) ?? NativeSelect

/** The host guide's caution marker, spread onto a control that removes something,
 *  or no marker on a host without it (the control works the same; the guide just
 *  does not pause on it). */
export const guideCaution: Readonly<Record<string, string>> =
  ('guideCaution' in ui ? ui.guideCaution : undefined) ?? {}

/** The dashboard's pull-request panel (App Kit seam level 2), or `null` on a
 *  host without it. The host builds it over this app's scoped client once
 *  `permissions.api` declares `/api/source/pull-request`, and refuses it
 *  otherwise; without the export the detail pane shows the review alone. */
export const PullRequestPanel =
  ('PullRequestPanel' in sdk ? sdk.PullRequestPanel : undefined) ?? null
