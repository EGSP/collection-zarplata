import 'antd/dist/reset.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Application } from './application';

const root = document.getElementById('root');
if (root === null) throw new Error('Не найден элемент #root');

createRoot(root).render(
    <StrictMode>
        <Application />
    </StrictMode>,
);
