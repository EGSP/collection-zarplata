import { pagePath, Pictograms, Tile, usePageView } from '../../web/sdk';

/**
 * Плитка главного экрана, ведущая на страницу «Рабочее место продавца». Без права открыть страницу
 * сервер не отдаёт её описание, и плитки нет: перечень требуемых объектов группы проверяет только
 * объекты, поэтому проверка страницы стоит здесь.
 */
export default function SellerWorkplaceTile() {
    const page = usePageView('sellerWorkplace');
    if (page === undefined) return null;
    return <Tile title={page.title} to={pagePath(page.name)} pictogram={<Pictograms.shop />} />;
}
