import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runScript, stackProject, withVerify } from './verify-fixtures.mjs'

const api = (dir, ...args) => runScript('verify-api.mjs', dir, args)

/** A fixture project with its stack up, taken down after [t]. */
function upProject(t, options) {
  const dir = stackProject(options)
  const up = runScript('verify-stack.mjs', dir, ['up'])
  assert.equal(up.status, 0, up.out)
  t.after(() => runScript('verify-stack.mjs', dir, ['down']))
  return dir
}

test('users mints each fresh user through the configured command and lists them', (t) => {
  // Given a project with its stack up
  const dir = upProject(t)

  // When three users are minted
  const { status, out } = api(dir, 'users', '3')

  // Then each is a distinct verify address with the token the mint command printed
  assert.equal(status, 0, out)
  const users = out.trim().split('\n').map((line) => line.split('\t'))
  assert.equal(users.length, 3)
  assert.equal(new Set(users.map(([email]) => email)).size, 3)
  for (const [email, token] of users) {
    assert.match(email, /^verify-[a-z0-9]+-\d@example\.invalid$/)
    assert.equal(token, `token-${email}`)
  }
})

test('a mutation as a user goes through the dev proxy with the CSRF pair, and the API admits it', (t) => {
  // Given a project with its stack up and a minted user
  const dir = upProject(t)
  const [email] = api(dir, 'users', '1').out.trim().split('\t')

  // When the user posts an order through the probe
  const post = api(dir, 'request', 'POST', '/orders', '--as', email, '--data', '{"sku":"stapler"}')

  // Then the API answers 201, so the cookie's decoded value went back as the header
  assert.equal(post.status, 0, post.out)
  assert.match(post.out, /^HTTP 201\n\{"sku":"stapler"\}/)

  // And the order is the user's
  const list = api(dir, 'request', 'GET', '/orders', '--as', email)
  assert.match(list.out, /^HTTP 200\n\[\{"sku":"stapler"\}\]/)
})

test('a refused request fails the probe, so test data is never taken as admitted', (t) => {
  // Given an API whose CSRF pair the config does not name
  const dir = upProject(t, { config: withVerify('').replace(", csrf: { cookie: 'XSRF-TOKEN', header: 'X-XSRF-TOKEN' }", '') })
  const [email] = api(dir, 'users', '1').out.trim().split('\t')

  // When a user posts an order
  const { status, out } = api(dir, 'request', 'POST', '/orders', '--as', email, '--data', '{"sku":"stapler"}')

  // Then the probe fails with the API's answer
  assert.equal(status, 1)
  assert.match(out, /^HTTP 403\n\{"error":"csrf"\}/)
})

test('--expect passes the status a probe is meant to see, and fails any other', (t) => {
  // Given a project with its stack up
  const dir = upProject(t)

  // When an anonymous post expects to be refused
  const refused = api(dir, 'request', 'POST', '/orders', '--data', '{}', '--expect', '401')

  // Then the probe passes on the 401
  assert.equal(refused.status, 0, refused.out)
  assert.match(refused.out, /^HTTP 401/)

  // And when a read expects a 404, the 200 it gets fails the probe
  const wrong = api(dir, 'request', 'GET', '/orders', '--expect', '404')
  assert.equal(wrong.status, 1)
  assert.match(wrong.out, /expected HTTP 404, got 200/)
})

test('--as takes a token as well as a minted user’s address', (t) => {
  // Given a project with its stack up
  const dir = upProject(t)

  // When a request is sent with a raw token
  const post = api(dir, 'request', 'POST', '/orders', '--as', 'token-by-hand', '--data', '{"sku":"pen"}')

  // Then the API takes it as that user
  assert.equal(post.status, 0, post.out)
  assert.match(api(dir, 'request', 'GET', '/orders', '--as', 'token-by-hand').out, /\[\{"sku":"pen"\}\]/)
})

test('an API that sets no CSRF cookie stops a mutation before it is sent', (t) => {
  // Given a config naming a cookie the API never sets
  const dir = upProject(t, { config: withVerify('').replace("cookie: 'XSRF-TOKEN'", "cookie: 'ACME-CSRF'") })

  // When a user posts an order
  const { status, out } = api(dir, 'request', 'POST', '/orders', '--as', 'token-x', '--data', '{}')

  // Then the probe stops naming the cookie and where it looked
  assert.equal(status, 1)
  assert.match(out, /GET \/api set no ACME-CSRF cookie/)
})

test('the probe stops when no verify stack is up, pointing at verify-stack', () => {
  // Given a project whose stack is down
  const dir = stackProject()

  // When a request is sent
  const { status, out } = api(dir, 'request', 'GET', '/orders')

  // Then it stops, naming how to bring the stack up
  assert.equal(status, 1)
  assert.match(out, /no verify stack is up.*verify-stack\.mjs up/s)
})

test('taking the stack down forgets its users and cookies', (t) => {
  // Given a minted user whose cookies the probe holds
  const dir = upProject(t)
  const [email] = api(dir, 'users', '1').out.trim().split('\t')
  api(dir, 'request', 'GET', '/orders', '--as', email)

  // When the stack goes down and comes up again
  runScript('verify-stack.mjs', dir, ['down'])
  runScript('verify-stack.mjs', dir, ['up'])

  // Then the probe no longer knows the old address, and says so rather than sending it as a token
  const users = join(dir, '.git', 'skrymer-ai', 'verify', 'probe', 'users.tsv')
  assert.throws(() => readFileSync(users))
  const { status, out } = api(dir, 'request', 'GET', '/orders', '--as', email)
  assert.equal(status, 1)
  assert.match(out, /no user .* was minted since the stack came up/)
})
