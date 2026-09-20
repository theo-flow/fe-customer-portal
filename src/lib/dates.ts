// Same ISO shape fn-16 reads and writes ("2026-10-10T12:00:00+00:00"): UTC, whole
// seconds, "+00:00" rather than "Z", so the two sides compare as strings.
export function isoUtc(d: Date): string {
  return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace('.000Z', '+00:00')
}

// Same day next month, clamped to the last day of a shorter month (31 Jan becomes
// 28 or 29 Feb) rather than rolling over into March. Mirrors fn-16's _add_one_month.
export function addOneMonth(d: Date): Date {
  const year  = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(
    year, month, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
  ))
}
