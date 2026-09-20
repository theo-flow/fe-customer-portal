import { randomInt } from 'crypto'

// No 0/O, 1/l/I, so a password read off an email is not mistyped.
const UPPER  = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER  = 'abcdefghijkmnpqrstuvwxyz'
const DIGITS = '23456789'
const ALL    = UPPER + LOWER + DIGITS

/** Days a temporary password stays valid; must match the user pool's TemporaryPasswordValidityDays. */
export const TEMP_PASSWORD_VALID_DAYS = 7

const pick = (set: string) => set[randomInt(set.length)]

/**
 * A random temporary password that meets the user pool policy (12 or more
 * characters with upper case, lower case and a number). Cryptographically
 * random, single use: Cognito forces the person to replace it at first sign-in.
 */
export function generateTempPassword(length = 16): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)]
  while (chars.length < length) chars.push(pick(ALL))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
