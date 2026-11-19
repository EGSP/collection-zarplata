/**
 * Объявление страницы «Сводка» с вкладками «Касса» (кассовая сводка за день) и «Период» (продажи,
 * проведённые и не проведённые в 1С, взносы по рассрочкам, товары в отвесе и должники за выбранные
 * дни). Компонент лежит в соседнем файле `period-summary.page-component.tsx`.
 */
import { page } from '../../server/ui/pages.js';

export const PeriodSummary = page('periodSummary').title('Сводка').icon('report');
