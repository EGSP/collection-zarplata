/**
 * Объявление страницы «Рабочее место продавца»: создание документов продаж, последние продажи,
 * незакрытые рассрочки по продажам и отвесы на одном экране. Компонент лежит в соседнем файле
 * `seller-workplace.page-component.tsx`.
 */
import { page } from '../../server/ui/pages.js';

export const SellerWorkplace = page('sellerWorkplace').title('Рабочее место продавца').icon('shop');
