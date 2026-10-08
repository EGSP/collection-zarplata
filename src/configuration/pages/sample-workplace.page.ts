/**
 * Объявление пробной страницы: по ней проверяются страницы конфигурации, пока прикладных рабочих
 * мест нет. Компонент лежит в соседнем файле `sample-workplace.page-component.tsx`.
 * Удаляется вместе с пробными объектами.
 */
import { page } from '../../server/ui/pages.js';

export const SampleWorkplace = page('sampleWorkplace').title('Пробное рабочее место');
