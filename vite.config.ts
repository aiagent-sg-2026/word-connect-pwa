import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => ({
  plugins: mode === 'development' ? [basicSsl()] : [],
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0')
  }
}));
