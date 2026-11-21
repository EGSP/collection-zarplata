/**
 * Страница «Сводка» с вкладками «Касса» для сверки дня и «Период» для фактических денежных
 * операций выбранных дней, взносов, сертификатов, должников и товаров в отвесе.
 */
import { page } from '../../server/ui/pages.js';

export const PeriodSummary = page('periodSummary').title('Сводка').icon('report');
