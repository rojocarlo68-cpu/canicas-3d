import { defineConfig } from 'vite'

export default defineConfig({
  base: '/canicas-3d/',
  server: {
    host: true,
    allowedHosts: true,
  },
})
