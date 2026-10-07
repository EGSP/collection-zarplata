import 'antd/dist/reset.css';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Application } from './application';

// Названия месяцев и дней недели в календаре берутся из языка dayjs, а не из языка Ant Design.
dayjs.locale('ru');

const root = document.getElementById('root');
if (root === null) throw new Error('Не найден элемент #root');

createRoot(root).render(
    <StrictMode>
        <Application />
    </StrictMode>,
);
