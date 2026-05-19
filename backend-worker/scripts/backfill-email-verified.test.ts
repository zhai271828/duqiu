import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyCandidate } from './backfill-email-verified.ts'

const candidate = {
  id: 1,
  email: 'user@example.com',
  firebase_uid: 'uid-123'
}

test('classifyCandidate marks matching verified Firebase user for update', () => {
  const decision = classifyCandidate(candidate, {
    localId: 'uid-123',
    email: 'user@example.com',
    emailVerified: true
  })

  assert.equal(decision.action, 'update')
  assert.equal(decision.reason, undefined)
})

test('classifyCandidate skips when Firebase localId does not match local firebase_uid', () => {
  const decision = classifyCandidate(candidate, {
    localId: 'uid-other',
    email: 'user@example.com',
    emailVerified: true
  })

  assert.equal(decision.action, 'skip')
  assert.equal(decision.reason, 'uid_mismatch')
})

test('classifyCandidate skips when Firebase user is not verified', () => {
  const decision = classifyCandidate(candidate, {
    localId: 'uid-123',
    email: 'user@example.com',
    emailVerified: false
  })

  assert.equal(decision.action, 'skip')
  assert.equal(decision.reason, 'not_verified')
})

test('classifyCandidate skips when Firebase user is missing', () => {
  const decision = classifyCandidate(candidate, undefined)

  assert.equal(decision.action, 'skip')
  assert.equal(decision.reason, 'not_found')
})
