// Numbers are entered as numbers: only digits, and for an amount one decimal
// point. Applied as the person types, so a letter never lands in the box.
// Amounts use a plain text input with a decimal keypad (inputMode) instead of
// type="number", because type="number" draws +/- spin arrows and changes the
// value on mouse-wheel scroll, which is wrong for money.
export function sanitizeNumeric(raw: string, kind: 'currency' | 'number'): string {
  if (kind === 'number') return raw.replace(/\D/g, '')

  // A comma is the decimal separator in many South African keyboards' habits.
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}
