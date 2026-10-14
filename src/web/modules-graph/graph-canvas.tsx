import {
    Background,
    Controls,
    type Edge,
    MarkerType,
    MiniMap,
    ReactFlow,
    useNodesInitialized,
    useNodesState,
    useReactFlow,
} from '@xyflow/react';
import { type GlobalToken, theme } from 'antd';
import { useEffect, useMemo, useRef } from 'react';
import { dependentsColor, linkStrokes, nodeSize } from './appearance';
import { layoutGraph } from './graph-layout';
import { dependentsShare, type Emphasis, type Focus, type GraphView, type LinkView, type Selection } from './graph-model';
import { EmphasisContext, type ModuleFlowNode, ModuleNode } from './module-node';

const nodeTypes = { module: ModuleNode };

interface GraphCanvasProps {
    readonly view: GraphView;
    /** Подсвеченные модули и связи; `null` — подсветки нет. Рассчитывает страница по наведению и выбору. */
    readonly emphasis: Emphasis | null;
    readonly selection: Selection;
    readonly onSelect: (selection: Selection) => void;
    /** Наведение курсора на модуль или связь холста; `null` — курсор ушёл с элемента. */
    readonly onHover: (focus: Focus | null) => void;
    /** Растёт при нажатии «Разложить заново»: холст рассчитывает размещение и сбрасывает перетаскивание. */
    readonly layoutVersion: number;
}

/**
 * Интерактивный холст графа на React Flow: перемещение и масштаб, перетаскивание узлов, выбор
 * модуля или связи щелчком, подсветка по наведению на холсте и в правой панели.
 *
 * Положение узлов хранит холст. Новое размещение рассчитывается при смене набора модулей
 * и связей или по запросу пользователя; подсветка и выбор положение не меняют.
 */
export function GraphCanvas({ view, emphasis, selection, onSelect, onHover, layoutVersion }: GraphCanvasProps) {
    const { token } = theme.useToken();
    const { fitView } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<ModuleFlowNode>([]);
    const nodesInitialized = useNodesInitialized();
    // Новую раскладку нужно вписать в окно, но только после того, как React Flow измерит новые узлы:
    // до измерения он не знает их границ и вписал бы лишь часть графа.
    const fitPending = useRef(false);

    useEffect(() => {
        const sized = [...view.modules.values()].map((moduleView) => {
            const share = dependentsShare(moduleView, view.maxDependents);
            return { moduleView, share, ...nodeSize(share) };
        });
        const positions = layoutGraph(
            sized.map(({ moduleView, width, height }) => ({ id: moduleView.module.id, width, height })),
            view.links.map(({ link }) => ({ source: link.sourceModuleId, target: link.targetModuleId })),
        );
        setNodes(sized.map(({ moduleView, share, width, height }) => ({
            id: moduleView.module.id,
            type: 'module',
            position: positions.get(moduleView.module.id) ?? { x: 0, y: 0 },
            width,
            height,
            data: { view: moduleView, share },
        })));
        fitPending.current = true;
    }, [view, layoutVersion, setNodes]);

    useEffect(() => {
        if (!fitPending.current || !nodesInitialized) return;
        fitPending.current = false;
        void fitView({ padding: 0.12, duration: 200 });
    }, [nodes, nodesInitialized, fitView]);

    // Выбор из панели подробностей должен отмечаться и на холсте.
    useEffect(() => {
        setNodes((current) => current.map((node) => {
            const selected = selection?.kind === 'module' && selection.id === node.id;
            return node.selected === selected ? node : { ...node, selected };
        }));
    }, [selection, setNodes]);

    const edges = useMemo(
        () => view.links.map((linkView) => flowEdge(linkView, token, emphasis, selection)),
        [view, token, emphasis, selection],
    );

    return (
        <EmphasisContext.Provider value={emphasis}>
            <ReactFlow<ModuleFlowNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onNodeClick={(_event, node) => onSelect({ kind: 'module', id: node.id })}
                onEdgeClick={(_event, edge) => onSelect({ kind: 'link', id: edge.id })}
                onPaneClick={() => onSelect(null)}
                onNodeMouseEnter={(_event, node) => onHover({ kind: 'module', id: node.id })}
                onNodeMouseLeave={() => onHover(null)}
                onEdgeMouseEnter={(_event, edge) => onHover({ kind: 'link', id: edge.id })}
                onEdgeMouseLeave={() => onHover(null)}
                nodesConnectable={false}
                minZoom={0.1}
                maxZoom={2.5}
                fitView
                fitViewOptions={{ padding: 0.12 }}
            >
                <Background gap={24} color={token.colorBorderSecondary} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable nodeColor={(node: ModuleFlowNode) => dependentsColor(node.data.share, token)} />
            </ReactFlow>
        </EmphasisContext.Provider>
    );
}

/**
 * Связь на холсте. Цвет и штрих задаёт категория, толщина растёт с числом внедрений.
 * Подсвеченная связь становится толще, остальные при подсветке почти исчезают.
 * Стрелка указывает на зависимость.
 */
function flowEdge({ id, link, category, injections }: LinkView, token: GlobalToken, emphasis: Emphasis | null, selection: Selection): Edge {
    const stroke = linkStrokes[category];
    const selected = selection?.kind === 'link' && selection.id === id;
    const emphasized = emphasis !== null && emphasis.linkIds.has(id);
    const dimmed = emphasis !== null && !emphasized;
    const width = stroke.width + Math.min(2, injections.length * 0.4) + (emphasized || selected ? 1.5 : 0);

    return {
        id,
        source: link.sourceModuleId,
        target: link.targetModuleId,
        selected,
        // Подсвеченные связи рисуются поверх остальных, иначе их перекрывали бы приглушённые.
        zIndex: emphasized || selected ? 1 : 0,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke.color, width: 14, height: 14 },
        style: {
            stroke: stroke.color,
            strokeWidth: width,
            // Круглые концы превращают короткие штрихи неиспользуемого импорта в точки.
            strokeLinecap: 'round',
            ...(stroke.dash === undefined ? {} : { strokeDasharray: stroke.dash }),
            opacity: dimmed ? 0.08 : 1,
            transition: `opacity ${token.motionDurationMid}`,
        },
        // Широкая невидимая полоса вокруг линии упрощает наведение и щелчок по тонкой связи.
        interactionWidth: 18,
        ...(link.dynamicImport ? {
            label: 'динамический',
            labelStyle: { fill: stroke.color, fontSize: token.fontSizeSM },
            labelBgStyle: { fill: token.colorBgContainer },
        } : {}),
    };
}
