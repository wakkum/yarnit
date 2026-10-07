import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset paths, so the same build works at a site root, under github.io/yarnit/, or opened by start.command
  base: './',
})
