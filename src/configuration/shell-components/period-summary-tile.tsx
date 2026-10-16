import { pagePath, Pictograms, Tile, usePageView } from '../../web/sdk';

/**
 * Плитка главного экрана, ведущая на отчёт «Сводка за период». Без права открыть страницу сервер
 * не отдаёт её описание, и плитки нет.
 */
export default function PeriodSummaryTile() {
    const page = usePageView('periodSummary');
    if (page === undefined) return null;
    return <Tile title={page.title} to={pagePath(page.name)} pictogram={<Pictograms.report />} />;
}
