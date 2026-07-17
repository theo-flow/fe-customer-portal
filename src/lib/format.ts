export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit',
  })
}
