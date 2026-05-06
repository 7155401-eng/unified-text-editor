import { defineConfig } from 'vite'

// משה 2026-05-07: base relative ('./') כדי שיעבוד גם ב-Vercel (root) וגם
// ב-GitHub Pages (subpath). אין צורך במשתנה סביבה.
const BASE = process.env.VITE_BASE || './'

export default defineConfig({
  base: BASE,
})
