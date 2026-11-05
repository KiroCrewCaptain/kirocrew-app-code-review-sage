/**
 * The dashboard's `i18n/all` entry, which its tests used to switch the language.
 * The bundle reads the host's active locale (`activeLocale` from the SDK stub),
 * so switching it is a stub control.
 */
import { stubLocale } from './app-sdk'

export const i18next = {
  async changeLanguage(locale: string): Promise<void> {
    stubLocale(locale)
  },
}
