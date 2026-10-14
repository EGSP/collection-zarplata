import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Клиент собирается в dist/web, откуда его раздаёт Nest.
// Кроме приложения, сборка содержит отдельную страницу графа модулей: она использует те же
// библиотеки интерфейса, но открывается вне оболочки приложения, как документация.
// В режиме разработки Vite проксирует на Nest /api и сайт документации /docs:
// без прокси адрес /docs открыл бы клиент, который отвечает своей страницей на любой адрес.
export default defineConfig({
    root: 'src/web',
    plugins: [react()],
    build: {
        outDir: '../../dist/web',
        emptyOutDir: true,
        rolldownOptions: {
            input: {
                application: path.resolve(import.meta.dirname, 'src/web/index.html'),
                modulesGraph: path.resolve(import.meta.dirname, 'src/web/modules-graph.html'),
            },
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
            '/docs': 'http://127.0.0.1:3000',
        },
    },
});
