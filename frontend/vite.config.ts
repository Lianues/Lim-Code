import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [vue()],
  // 仅本地开发使用：允许 VS Code webview(vscode-webview://...) 跨域加载 Vite 资源
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: {
      origin: '*',
      methods: ['GET', 'HEAD', 'OPTIONS'],
      allowedHeaders: ['*']
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'index.css';
          }
          return 'assets/[name][extname]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});