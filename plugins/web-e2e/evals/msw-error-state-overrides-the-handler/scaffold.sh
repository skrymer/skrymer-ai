#!/usr/bin/env bash
# A tiny Vitest project whose profile card reads /api/users/me, with an MSW baseline that
# answers it and one test for the happy path. Dependencies are declared, not installed.
set -euo pipefail
mkdir -p src test/mocks/handlers
cat > package.json <<'JSON'
{
  "name": "initech-portal",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "msw": "^3.0.1", "vitest": "^4.0.0", "happy-dom": "^20.0.0", "ofetch": "^1.4.0" }
}
JSON
cat > vitest.config.ts <<'TS'
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { environment: 'happy-dom', setupFiles: ['test/setup.ts'] } })
TS
cat > src/api.ts <<'TS'
import { ofetch } from 'ofetch'

export interface User { id: string; name: string }

/** The signed-in user. */
export const fetchMe = () => ofetch<User>('/api/users/me', { baseURL: location.origin, retry: 0 })
TS
cat > src/profile-card.ts <<'TS'
import { fetchMe } from './api'

/** Renders the signed-in user's profile card into [root]: their name, or an alert when it can't load. */
export async function renderProfileCard(root: HTMLElement) {
  root.innerHTML = '<p role="status">Loading…</p>'
  try {
    const user = await fetchMe()
    root.innerHTML = `<h2>${user.name}</h2>`
  } catch {
    root.innerHTML = '<p role="alert">Couldn’t load your profile. Try again later.</p>'
  }
}
TS
cat > test/mocks/handlers/users.ts <<'TS'
import { http, HttpResponse } from 'msw'

/** The baseline signed-in user every test starts from. */
export const baselineUser = { id: 'u-1', name: 'Peter Gibbons' }

export const userHandlers = [http.get('*/api/users/me', () => HttpResponse.json(baselineUser))]
TS
cat > test/mocks/handlers/index.ts <<'TS'
import { userHandlers } from './users'

export const handlers = [...userHandlers]
TS
cat > test/mocks/node.ts <<'TS'
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
TS
cat > test/setup.ts <<'TS'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './mocks/node'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
TS
cat > src/profile-card.test.ts <<'TS'
import { expect, it } from 'vitest'
import { renderProfileCard } from './profile-card'

it('shows the signed-in user’s name', async () => {
  // Given an empty page
  const root = document.createElement('div')

  // When the profile card renders
  await renderProfileCard(root)

  // Then it names the baseline user
  expect(root.querySelector('h2')?.textContent).toBe('Peter Gibbons')
})
TS
