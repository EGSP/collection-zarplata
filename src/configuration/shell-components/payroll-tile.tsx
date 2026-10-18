import { pagePath, Pictograms, Tile, usePageView } from '../../web/sdk';

/**
 * Плитка главного экрана, ведущая на страницу «Зарплата». Без права открыть страницу сервер
 * не отдаёт её описание, и плитки нет.
 */
export default function PayrollTile() {
    const page = usePageView('payroll');
    if (page === undefined) return null;
    return <Tile title={page.title} to={pagePath(page.name)} pictogram={<Pictograms.salary />} />;
}
