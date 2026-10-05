import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { mkdirSync } from 'fs'
import type { PageLoader } from './indeed'

/**
 * A normal, visible Chrome window for Indeed's search pages. It is plain
 * automation and says so: nothing here hides that from the site or tries to
 * get past a verification page. Indeed sometimes holds an automated window
 * at one. When it does, the person at the keyboard can clear it in the
 * window and the load carries on; otherwise that query fails and says why.
 *
 * The window keeps a profile folder of its own, so Indeed's cookies last
 * between runs. It is never the user's own Chrome profile, and never signed in.
 */

const NAVIGATION_TIMEOUT_MS = 30_000
/** A results page is up well within this; past it, say what is on screen. */
const FIRST_LOOK_MS = 8_000
/** How long a person then has to clear a verification page before the query gives up. */
const CLEAR_WAIT_MS = 90_000

export interface IndeedBrowser {
  load: PageLoader
  close(): Promise<void>
}

const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0]

/** The results model is on every search page, matches or none, and on no
 *  verification page. Polled on a timer: a window in the background gets no
 *  animation frames. */
function resultsWithin(page: Page, timeout: number): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const w = window as unknown as { mosaic?: { providerData?: Record<string, unknown> } }
        return Boolean(w.mosaic?.providerData?.['mosaic-provider-jobcards'])
      },
      undefined,
      { timeout, polling: 500 },
    )
    .then(
      () => true,
      (err: unknown) => {
        // Only running out of time means "not there yet". A closed or crashed
        // page is a failure of its own and must not be reported as a wait.
        if (err instanceof Error && err.name === 'TimeoutError') return false
        throw new Error(page.isClosed() ? 'the browser window was closed before results loaded.' : firstLine(err))
      },
    )
}

function verificationShowing(page: Page): Promise<boolean> {
  return page
    .evaluate(() =>
      /just a moment|verification required|verify you are human/i.test(
        `${document.title} ${(document.body?.innerText ?? '').slice(0, 2000)}`,
      ),
    )
    .catch(() => false)
}

export async function openIndeedBrowser(
  profileDir: string,
  log: (message: string) => void = () => {},
): Promise<IndeedBrowser> {
  mkdirSync(profileDir, { recursive: true })
  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
    })
  } catch (err) {
    throw new Error(`could not open Google Chrome (is it installed?): ${firstLine(err)}`)
  }
  let page: Page
  try {
    page = context.pages()[0] ?? (await context.newPage())
  } catch (err) {
    await context.close().catch(() => {})
    throw new Error(`could not open a tab in Google Chrome: ${firstLine(err)}`)
  }

  return {
    async load(url) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
      } catch (err) {
        throw new Error(`could not load the search page: ${firstLine(err)}`)
      }
      if (await resultsWithin(page, FIRST_LOOK_MS)) return page.content()
      if (await verificationShowing(page)) {
        log(
          `Indeed is showing a verification page in the Chrome window. Waiting up to ${CLEAR_WAIT_MS / 1000}s for it to be cleared there.`,
        )
      }
      if (await resultsWithin(page, CLEAR_WAIT_MS)) return page.content()
      throw new Error(
        (await verificationShowing(page))
          ? 'Indeed held the browser window at its verification page.'
          : `no results page after ${(FIRST_LOOK_MS + CLEAR_WAIT_MS) / 1000}s.`,
      )
    },
    close: () => context.close(),
  }
}
