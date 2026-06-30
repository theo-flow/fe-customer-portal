/**
 * SA-specific field validators for TheoFlow Harvest.
 * All validators return null on success or an error string on failure.
 */

// ── SA ID number ─────────────────────────────────────────────────────────────

export function validateSaId(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 13) return 'SA ID number must be exactly 13 digits'

  // Date prefix: YYMMDD — basic range check
  const mm = parseInt(digits.slice(2, 4), 10)
  const dd = parseInt(digits.slice(4, 6), 10)
  if (mm < 1 || mm > 12) return 'SA ID number contains an invalid month'
  if (dd < 1 || dd > 31) return 'SA ID number contains an invalid day'

  // Luhn check
  let sum = 0
  for (let i = 0; i < 13; i++) {
    let n = parseInt(digits[i], 10)
    if ((13 - i) % 2 === 0) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  if (sum % 10 !== 0) return 'SA ID number is invalid (checksum failed)'

  return null
}

// ── SA phone number ───────────────────────────────────────────────────────────

const SA_PHONE_RE = /^(?:\+27|0027|0)(\d{9})$/

export function validatePhone(value: string): string | null {
  const stripped = value.replace(/[\s\-().]/g, '')
  if (!SA_PHONE_RE.test(stripped)) {
    return 'Enter a valid South African phone number (e.g. 071 234 5678 or +27 71 234 5678)'
  }
  return null
}

// ── Date ─────────────────────────────────────────────────────────────────────

const DATE_FORMATS = [
  /^(\d{2})\/(\d{2})\/(\d{4})$/,   // dd/mm/yyyy
  /^(\d{4})-(\d{2})-(\d{2})$/,     // yyyy-mm-dd (HTML date input)
  /^(\d{2})-(\d{2})-(\d{4})$/,     // dd-mm-yyyy
]

export function validateDate(value: string): string | null {
  for (const re of DATE_FORMATS) {
    const m = value.match(re)
    if (m) {
      const [, a, b, c] = m
      // yyyy-mm-dd format
      const [year, month, day] = a.length === 4
        ? [parseInt(a, 10), parseInt(b, 10), parseInt(c, 10)]
        : [parseInt(c, 10), parseInt(b, 10), parseInt(a, 10)]

      if (month < 1 || month > 12) return 'Date contains an invalid month'
      if (day < 1 || day > 31)     return 'Date contains an invalid day'
      if (year < 1900 || year > 2100) return 'Date year is out of range'
      return null
    }
  }
  return 'Enter a date in dd/mm/yyyy format'
}

// ── Email ─────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(value: string): string | null {
  if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address'
  return null
}

// ── Currency (Rand) ───────────────────────────────────────────────────────────

const CURRENCY_RE = /^R?\s*\d{1,12}(\.\d{1,2})?$/

export function validateCurrency(value: string): string | null {
  const stripped = value.replace(/\s/g, '')
  if (!CURRENCY_RE.test(stripped)) return 'Enter an amount in Rand (e.g. R 1 500.00 or 1500)'
  const num = parseFloat(stripped.replace(/^R/, ''))
  if (num < 0) return 'Amount cannot be negative'
  return null
}

// ── Generic required check ────────────────────────────────────────────────────

export function validateRequired(value: string, label: string): string | null {
  if (!value || value.trim() === '' || value === 'false') {
    return `${label} is required`
  }
  return null
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export function validateField(
  fieldType: string,
  value:     string,
  required:  boolean,
  label:     string,
): string | null {
  if (required) {
    const reqErr = validateRequired(value, label)
    if (reqErr) return reqErr
  }

  // Skip type validation if empty and not required
  if (!value || !value.trim()) return null

  switch (fieldType) {
    case 'sa_id':    return validateSaId(value)
    case 'phone':    return validatePhone(value)
    case 'date':     return validateDate(value)
    case 'email':    return validateEmail(value)
    case 'currency': return validateCurrency(value)
    default:         return null
  }
}
