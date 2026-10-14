/**
 * Начальное размещение узлов. Граф модулей направленный и почти без циклов, поэтому подходит
 * послойная раскладка (метод Сугиямы), которую выполняет dagre:
 *
 * 1. Модули распределяются по слоям так, чтобы каждая связь шла сверху вниз: зависимый модуль
 *    оказывается выше своей зависимости. Корневой модуль приложения попадает наверх, общие
 *    модули вроде настроек и базы данных — вниз.
 * 2. Внутри слоя порядок модулей подбирается так, чтобы связи между соседними слоями
 *    пересекались как можно реже.
 * 3. Координаты учитывают размер каждого узла, поэтому крупные узлы не налезают на соседей.
 *
 * Циклы через `forwardRef()` dagre разрывает сам, временно разворачивая одну из связей.
 * Раскладка задаёт только начальное положение: пользователь может перетаскивать узлы,
 * а кнопка «Разложить заново» возвращает рассчитанное размещение.
 */
import dagre from '@dagrejs/dagre';

export interface LayoutNode {
    readonly id: string;
    readonly width: number;
    readonly height: number;
}

export interface LayoutEdge {
    readonly source: string;
    readonly target: string;
}

/** Положение левого верхнего угла узла, как его ожидает React Flow. */
export interface NodePosition {
    readonly x: number;
    readonly y: number;
}

export function layoutGraph(nodes: ReadonlyArray<LayoutNode>, edges: ReadonlyArray<LayoutEdge>): ReadonlyMap<string, NodePosition> {
    const graph = new dagre.graphlib.Graph();
    // Расстояние между слоями больше, чем внутри слоя: так видно направление связей и подписи на них.
    graph.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 110, edgesep: 16, ranker: 'network-simplex' });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
    for (const edge of edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);

    const positions = new Map<string, NodePosition>();
    for (const node of nodes) {
        // dagre возвращает центр узла, React Flow размещает узел по левому верхнему углу.
        const { x, y } = graph.node(node.id) as { x: number; y: number };
        positions.set(node.id, { x: x - node.width / 2, y: y - node.height / 2 });
    }
    return positions;
}
