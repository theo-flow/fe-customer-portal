# Self-hosted fonts

`layout.tsx` uses `next/font/local`, which expects these 4 files in this
directory (git-ignored nowhere -- commit them normally, they're small and
need to ship with every build):

```
src/app/fonts/
  PlayfairDisplay-Variable.woff2         (upright, weight axis 400-900)
  PlayfairDisplay-Italic-Variable.woff2  (italic,  weight axis 400-900)
  Inter-Variable.woff2                   (weight axis 100-900)
  JetBrainsMono-Variable.woff2           (weight axis 100-800)
```

All three families are Open Font License (OFL) -- free to redistribute and
self-host, no licensing concern.

## Getting the files (from a machine with normal internet access)

**Easiest: [Google Webfonts Helper](https://gwfh.mranftl.com/fonts)** --
search each family, select the "variable" download option if offered (Inter,
JetBrains Mono, and Playfair Display all ship official variable builds), and
it hands you ready-to-use `.woff2` files with no conversion step. Rename
whatever it gives you to match the exact filenames above.

**Alternative: [Google Fonts](https://fonts.google.com) directly** -- each
family's page has a "Download family" button. The files download as `.ttf`;
convert to `.woff2` with a tool like
[Transfonter](https://transfonter.org/) or the `fonttools`/`woff2` CLI
(`woff2_compress PlayfairDisplay[wght].ttf`).

**Alternative: [google/fonts GitHub repo](https://github.com/google/fonts)**
-- the canonical source (`ofl/playfairdisplay/`, `ofl/inter/`,
`ofl/jetbrainsmono/`), ships variable `.ttf` files needing the same
conversion step as above.

## Verifying

After placing the files, `npm run build` should complete with no
`next/font` errors. If a filename doesn't match exactly what `layout.tsx`
references, Next will fail fast at build time with a clear "module not
found" pointing at the missing path.
