import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { Button, Checkbox, Flex, Layout, Result, theme, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { ModulesGraph } from '../../common/modules-graph';
import { ApiError, request } from '../common/api';
import { Pending } from '../common/pending';
import { Icons } from '../sdk/ds/icons';
import { DetailsPanel, type PinnedFocus } from './details-panel';
import { GraphCanvas } from './graph-canvas';
import { buildGraphView, emphasisOf, type Focus, type Selection } from './graph-model';

/**
 * Страница графа модулей Nest: панель настроек сверху, холст графа и панель подробностей справа.
 * Граф сервер строит один раз за запуск, поэтому запрос не повторяется при возврате на вкладку.
 */
export function ModulesGraphPage() {
    const graph = useQuery({
        queryKey: ['modules-graph'],
        queryFn: () => request<ModulesGraph>({ url: '/modules-graph' }),
        staleTime: Infinity,
        retry: false,
    });
    if (graph.data !== undefined) return <GraphWorkspace graph={graph.data} />;
    if (!graph.isError) return <Pending fullPage />;
    const unauthenticated = graph.error instanceof ApiError && graph.error.statusCode === 401;
    return (
        <Result
            status={unauthenticated ? 'warning' : 'error'}
            title={unauthenticated ? 'Нужно войти в приложение' : 'Не удалось загрузить граф модулей'}
            subTitle={unauthenticated ? 'Граф доступен только вошедшему пользователю. Войдите в приложение и обновите страницу.' : graph.error.message}
            extra={unauthenticated
                ? <Button type="primary" href="/">Открыть приложение</Button>
                : <Button type="primary" onClick={() => void graph.refetch()}>Повторить</Button>}
        />
    );
}

/**
 * Рабочая область графа. Подсветку на холсте определяет первый из источников:
 * наведение на холсте, наведение в панели, выбранный элемент, закреплённый пункт легенды.
 * Наведение важнее выбора: так можно посмотреть соседей другого модуля, не теряя выбранный.
 */
function GraphWorkspace({ graph }: { readonly graph: ModulesGraph }) {
    const { token } = theme.useToken();
    // Ядро Nest связано почти только с модулями, раздающими HTTP, и по умолчанию лишь загромождает граф.
    const [showCore, setShowCore] = useState(false);
    const [showGlobalLinks, setShowGlobalLinks] = useState(true);
    const [selection, setSelectionState] = useState<Selection>(null);
    const [pinned, setPinned] = useState<PinnedFocus>(null);
    const [canvasHover, setCanvasHover] = useState<Focus | null>(null);
    const [panelHover, setPanelHover] = useState<Focus | null>(null);
    const [layoutVersion, setLayoutVersion] = useState(0);
    const view = useMemo(() => buildGraphView(graph, { showCore, showGlobalLinks }), [graph, showCore, showGlobalLinks]);
    const emphasis = useMemo(
        () => emphasisOf(view, canvasHover ?? panelHover ?? selection ?? pinned),
        [view, canvasHover, panelHover, selection, pinned],
    );

    // Выбор меняет содержимое панели, и строка под курсором исчезает, не сообщив об уходе курсора.
    const setSelection = (next: Selection) => {
        setPanelHover(null);
        setSelectionState(next);
    };

    return (
        <Layout style={{ height: '100vh' }}>
            <Flex
                align="center"
                gap={token.marginLG}
                wrap
                style={{ padding: `${token.paddingSM}px ${token.padding}px`, background: token.colorBgContainer, borderBlockEnd: `1px solid ${token.colorBorderSecondary}` }}
            >
                {/* Страница открыта в отдельной вкладке без связи с вкладкой приложения, поэтому возврат
                    открывает приложение по его адресу, а не переключает вкладку браузера. */}
                <Button icon={<Icons.home />} href="/">В приложение</Button>
                <Typography.Title level={5} style={{ margin: 0 }}>Граф модулей Nest</Typography.Title>
                <Tooltip title="Связи модулей, которые внедряют провайдеры глобального модуля без импорта">
                    <Checkbox checked={showGlobalLinks} onChange={(event) => setShowGlobalLinks(event.target.checked)}>Связи через @Global()</Checkbox>
                </Tooltip>
                <Tooltip title="Служебный модуль Nest с HttpAdapterHost, ModulesContainer и другими средствами ядра">
                    <Checkbox checked={showCore} onChange={(event) => setShowCore(event.target.checked)}>Ядро Nest</Checkbox>
                </Tooltip>
                <Button onClick={() => setLayoutVersion((version) => version + 1)}>Разложить заново</Button>
            </Flex>
            <Layout>
                <Layout.Content style={{ minWidth: 0 }}>
                    <ReactFlowProvider>
                        <GraphCanvas
                            view={view}
                            emphasis={emphasis}
                            selection={selection}
                            onSelect={setSelection}
                            onHover={setCanvasHover}
                            layoutVersion={layoutVersion}
                        />
                    </ReactFlowProvider>
                </Layout.Content>
                <Layout.Sider
                    theme="light"
                    width={420}
                    style={{ borderInlineStart: `1px solid ${token.colorBorderSecondary}`, overflowY: 'auto', padding: token.padding }}
                >
                    <DetailsPanel view={view} selection={selection} pinned={pinned} onSelect={setSelection} onPin={setPinned} onHover={setPanelHover} />
                </Layout.Sider>
            </Layout>
        </Layout>
    );
}
