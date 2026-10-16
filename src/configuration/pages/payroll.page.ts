/**
 * Объявление страницы «Зарплата»: начисление незакрытого периода по сотрудникам с расшифровкой
 * и закрытие периода. Компонент лежит в соседнем файле `payroll.page-component.tsx`.
 */
import { page } from '../../server/ui/pages.js';

export const Payroll = page('payroll').title('Зарплата');
