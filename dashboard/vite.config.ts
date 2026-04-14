import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              /react|react-dom|react-router-dom/.test(id)
            ) {
              return 'vendor-react';
            }
            if (
              /@radix-ui\/react-(dialog|dropdown-menu|select|tabs|switch|tooltip|toast)/.test(id)
            ) {
              return 'vendor-radix';
            }
            if (/recharts/.test(id)) {
              return 'vendor-recharts';
            }
            if (/@sentry\/react/.test(id)) {
              return 'vendor-glitchtip';
            }
          }
        },
      },
    },
    chunkSizeWarningLimit: 300,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
