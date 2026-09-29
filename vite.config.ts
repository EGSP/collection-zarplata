import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Клиент собирается в dist/web, откуда его раздаёт Nest.
// В режиме разработки Vite проксирует /api на Nest.
export default defineConfig({
    root: 'src/web',
    plugins: [react()],
    build: {
        outDir: '../../dist/web',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
        },
    },
});
