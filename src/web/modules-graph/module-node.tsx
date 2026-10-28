import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Flex, theme, Typography } from 'antd';
import { type ComponentType, createContext, useContext } from 'react';
import type { ModuleKind } from '../../common/modules-graph';
import { Icons } from '../sdk/ds/icons';
import { dependentsColor, dependentsTextColor, moduleKindTitles, moduleShapeStyle, plural } from './appearance';
import type { Emphasis, ModuleView } from './graph-model';

export interface ModuleNodeData extends Record<string, unknown> {
    readonly view: ModuleView;
    /** Доля зависимых от наибольшего числа, от 0 до 1: задаёт размер и насыщенность заливки. */
    readonly share: number;
}

export type ModuleFlowNode = Node<ModuleNodeData, 'module'>;

/**
 * Подсвеченные модули и связи. Подсветка передаётся контекстом, а не данными узлов: иначе каждое
 * движение курсора пересоздавало бы все узлы холста. `null` означает, что подсветки нет.
 */
export const EmphasisContext = createContext<Emphasis | null>(null);

/** Значок вида модуля. У обычного модуля значка нет: он встречается чаще всех и служит фоном. */
export const moduleKindIcons: Readonly<Record<ModuleKind, ComponentType | undefined>> = {
    regular: undefined,
    global: Icons.globalModule,
    dynamic: Icons.dynamicModule,
    core: Icons.coreModule,
};

/**
 * Узел модуля: имя, вид и число зависимых. Заливка и размер показывают число зависимых,
 * форма, рамка и значок — вид модуля.
 */
export function ModuleNode({ id, data, selected, width, height }: NodeProps<ModuleFlowNode>) {
    const { token } = theme.useToken();
    const emphasis = useContext(EmphasisContext);
    const { module, dependents } = data.view;
    const textColor = dependentsTextColor(data.share, token);
    const dimmed = emphasis !== null && !emphasis.moduleIds.has(id);
    const KindIcon = moduleKindIcons[module.kind];
    // Название крупнее у модулей с большим числом зависимых: размер узла и текста растут вместе.
    const titleSize = Math.round(token.fontSize * (1 + 0.35 * Math.sqrt(data.share)));
    // Капсула глобального модуля скругляет края на половину высоты, поэтому текст отодвинут от них.
    const inlinePadding = module.kind === 'global' ? (height ?? 0) / 3 : token.paddingSM;

    return (
        <Flex
            vertical
            justify="center"
            style={{
                ...moduleShapeStyle(module.kind, dependentsColor(data.share, token), height ?? 0, token),
                width,
                height,
                padding: `${token.paddingXS}px ${inlinePadding}px`,
                // Выбор обозначен кольцом вокруг узла: рамка уже занята видом модуля.
                outline: selected ? `3px solid ${token.colorText}` : 'none',
                outlineOffset: 3,
                boxShadow: token.boxShadowTertiary,
                opacity: dimmed ? 0.2 : 1,
                transition: `opacity ${token.motionDurationMid}`,
                color: textColor,
                cursor: 'pointer',
            }}
        >
            {/* Точки присоединения связей: сверху входят связи от зависимых, снизу выходят к зависимостям. */}
            <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
            <Typography.Text strong ellipsis style={{ fontSize: titleSize, color: textColor }}>
                {KindIcon !== undefined && <KindIcon />} {module.name}
            </Typography.Text>
            <Typography.Text style={{ fontSize: token.fontSizeSM, color: textColor }}>
                {moduleKindTitles[module.kind]} · {dependents.length} {plural(dependents.length, 'зависимый', 'зависимых', 'зависимых')}
            </Typography.Text>
            <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
        </Flex>
    );
}
