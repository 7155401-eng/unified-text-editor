import { defineConfig } from 'vite'

const BASE = process.env.VITE_BASE || '/unified-text-editor/'

export default defineConfig({
  base: BASE,
})
