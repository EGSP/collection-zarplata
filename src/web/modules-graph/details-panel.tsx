import { Button, Descriptions, Empty, Flex, Space, Table, Tag, theme, Typography } from 'antd';
import { type ReactNode, useState } from 'react';
import type { ModuleKind, ModulesGraphClass, ModulesGraphInjection } from '../../common/modules-graph';
import {
    classKindTitles,
    dependentsPalette,
    linkCategoryDescriptions,
    linkCategoryTitles,
    linkStrokes,
    moduleKindDescriptions,
    moduleKindTitles,
    moduleShapeStyle,
    plural,
    providerShapeTitles,
} from './appearance';
import { type Focus, type GraphView, type LinkCategory, linkCategories, linkId, type LinkView, type ModuleView, type Selection } from './graph-model';
import { moduleKindIcons } from './module-node';

/** Подсветка, которую можно закрепить щелчком по пункту легенды: категория связей или вид модуля. */
export type PinnedFocus = Extract<Focus, { kind: 'link-category' | 'module-kind' }> | null;

interface DetailsPanelProps {
    readonly view: GraphView;
    readonly selection: Selection;
    readonly pinned: PinnedFocus;
    readonly onSelect: (selection: Selection) => void;
    readonly onPin: (pinned: PinnedFocus) => void;
    /** Наведение на элемент панели подсвечивает его на холсте; `null` — курсор ушёл с элемента. */
    readonly onHover: (focus: Focus | null) => void;
}

const moduleKinds: ReadonlyArray<ModuleKind> = ['regular', 'global', 'dynamic', 'core'];

/**
 * Правая панель страницы: подробности выбранного модуля или связи, а без выбора — легенда.
 *
 * Панель связана с холстом в обе стороны. Наведение на пункт легенды, модуль или связь подсвечивает
 * их на холсте. Щелчок по пункту легенды закрепляет подсветку и раскрывает список его модулей
 * или связей; щелчок по модулю или связи в панели выбирает их.
 */
export function DetailsPanel(props: DetailsPanelProps) {
    const { view, selection, onSelect } = props;
    if (selection?.kind === 'module') {
        const moduleView = view.modules.get(selection.id);
        if (moduleView !== undefined) return <ModuleDetails {...props} moduleView={moduleView} />;
    }
    if (selection?.kind === 'link') {
        const linkView = view.links.find((candidate) => candidate.id === selection.id);
        if (linkView !== undefined) return <LinkDetails {...props} linkView={linkView} />;
    }
    return <Legend {...props} onSelect={onSelect} />;
}

function Legend({ view, pinned, onPin, onHover, onSelect }: DetailsPanelProps) {
    const { token } = theme.useToken();
    const togglePin = (focus: NonNullable<PinnedFocus>) => onPin(isSameFocus(pinned, focus) ? null : focus);
    return (
        <Flex vertical gap={token.marginMD}>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                {view.modules.size} {plural(view.modules.size, 'модуль', 'модуля', 'модулей')}, {view.links.length} {plural(view.links.length, 'связь', 'связи', 'связей')}.
                Стрелка ведёт от зависимого модуля к зависимости. Наведите курсор на пункт легенды, чтобы подсветить
                его на графе; щелчок закрепляет подсветку и показывает список.
            </Typography.Paragraph>

            <Section title="Связи">
                {linkCategories.map((category) => {
                    const links = view.links.filter((linkView) => linkView.category === category);
                    const focus = { kind: 'link-category', category } as const;
                    const active = isSameFocus(pinned, focus);
                    return (
                        <div key={category}>
                            <HoverRow active={active} onHover={(hovered) => onHover(hovered ? focus : null)} onClick={() => togglePin(focus)} disabled={links.length === 0}>
                                <Flex gap={token.marginXS} align="baseline">
                                    <LineSample category={category} />
                                    <div>
                                        <Typography.Text strong>{linkCategoryTitles[category]}</Typography.Text>{' '}
                                        <Typography.Text type="secondary">{links.length}</Typography.Text>
                                        <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: token.fontSizeSM }}>
                                            {linkCategoryDescriptions[category]}
                                        </Typography.Paragraph>
                                    </div>
                                </Flex>
                            </HoverRow>
                            {active && <LinkList links={links} view={view} show="both" onHover={onHover} onSelect={onSelect} />}
                        </div>
                    );
                })}
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Толщина линии растёт с числом внедрений через связь.</Typography.Text>
            </Section>

            <Section title="Вид модуля">
                {moduleKinds.map((moduleKind) => {
                    const modules = [...view.modules.values()].filter(({ module }) => module.kind === moduleKind);
                    const focus = { kind: 'module-kind', moduleKind } as const;
                    const active = isSameFocus(pinned, focus);
                    return (
                        <div key={moduleKind}>
                            <HoverRow active={active} onHover={(hovered) => onHover(hovered ? focus : null)} onClick={() => togglePin(focus)} disabled={modules.length === 0}>
                                <Flex gap={token.marginSM} align="center">
                                    <ShapeSample moduleKind={moduleKind} />
                                    <div>
                                        <Typography.Text strong>{moduleKindTitles[moduleKind]}</Typography.Text>{' '}
                                        <Typography.Text type="secondary">{modules.length}</Typography.Text>
                                        <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: token.fontSizeSM }}>
                                            {moduleKindDescriptions[moduleKind]}
                                        </Typography.Paragraph>
                                    </div>
                                </Flex>
                            </HoverRow>
                            {active && (
                                <Flex vertical style={{ paddingInlineStart: token.paddingLG }}>
                                    {modules.map(({ module }) => (
                                        <ModuleLink key={module.id} id={module.id} name={module.name} onHover={onHover} onSelect={onSelect} />
                                    ))}
                                </Flex>
                            )}
                        </div>
                    );
                })}
            </Section>

            <Section title="Число зависимых">
                <Flex gap={2} style={{ marginBlockEnd: token.marginXS }}>
                    {dependentsPalette(token).map((color) => <div key={color} style={{ flex: 1, height: 12, background: color }} />)}
                </Flex>
                <Flex justify="space-between">
                    <Typography.Text type="secondary">0</Typography.Text>
                    <Typography.Text type="secondary">{view.maxDependents}</Typography.Text>
                </Flex>
                <Typography.Paragraph type="secondary" style={{ margin: `${token.marginXS}px 0 0`, fontSize: token.fontSizeSM }}>
                    Чем больше модулей зависит от модуля, тем насыщеннее заливка и крупнее узел. Зависимым считается
                    модуль, который импортирует данный или внедряет его провайдеры.
                </Typography.Paragraph>
            </Section>
        </Flex>
    );
}

function ModuleDetails({ view, moduleView, onSelect, onHover }: DetailsPanelProps & { readonly moduleView: ModuleView }) {
    const { token } = theme.useToken();
    const { module } = moduleView;
    const outgoing = view.links.filter((linkView) => linkView.link.sourceModuleId === module.id);
    const incoming = view.links.filter((linkView) => linkView.link.targetModuleId === module.id);
    const unused = outgoing.filter((linkView) => linkView.category === 'unused');
    const KindIcon = moduleKindIcons[module.kind];
    return (
        <Flex vertical gap={token.marginMD}>
            <BackButton onSelect={onSelect} />
            <div>
                <Typography.Title level={4} style={{ margin: 0 }}>{module.name}</Typography.Title>
                <Tag icon={KindIcon === undefined ? undefined : <KindIcon />} style={{ marginBlockStart: token.marginXS }}>{moduleKindTitles[module.kind]}</Tag>
                <Typography.Paragraph type="secondary" style={{ margin: `${token.marginXS}px 0 0` }}>{moduleKindDescriptions[module.kind]}</Typography.Paragraph>
            </div>

            <Descriptions size="small" column={1} bordered items={[
                { key: 'dependents', label: 'Зависимых модулей', children: moduleView.dependents.length },
                { key: 'dependencies', label: 'Зависимостей', children: moduleView.dependencies.length },
                { key: 'unused', label: 'Неиспользуемых импортов', children: unused.length },
                { key: 'classes', label: 'Классов', children: module.classes.length },
                ...(module.reexportedModules.length === 0 ? [] : [{ key: 'reexported', label: 'Реэкспортирует', children: module.reexportedModules.join(', ') }]),
            ]} />

            <Section title="Классы">
                {module.classes.length === 0 ? <Typography.Text type="secondary">Нет собственных классов.</Typography.Text> : (
                    <Flex vertical gap={token.marginXS}>
                        {module.classes.map((moduleClass) => <ClassDescription key={`${moduleClass.kind}:${moduleClass.name}`} moduleClass={moduleClass} />)}
                    </Flex>
                )}
            </Section>

            {outgoing.length > 0 && (
                <Section title="Зависит от">
                    <LinkList links={outgoing} view={view} show="target" onHover={onHover} onSelect={onSelect} />
                </Section>
            )}
            {incoming.length > 0 && (
                <Section title="Используется в">
                    <LinkList links={incoming} view={view} show="source" onHover={onHover} onSelect={onSelect} />
                </Section>
            )}

            {moduleView.internalInjections.length > 0 && (
                <Section title="Внедрения внутри модуля">
                    <InjectionTable injections={moduleView.internalInjections} />
                </Section>
            )}
        </Flex>
    );
}

function ClassDescription({ moduleClass }: { readonly moduleClass: ModulesGraphClass }) {
    const shape = providerShapeTitles[moduleClass.shape];
    return (
        <Space size={4} wrap>
            <Typography.Text code>{moduleClass.name}</Typography.Text>
            <Tag>{classKindTitles[moduleClass.kind]}</Tag>
            {moduleClass.enhancerType !== undefined && <Tag>{moduleClass.enhancerType}</Tag>}
            {shape !== undefined && <Tag>{shape}</Tag>}
            {moduleClass.exported && <Tag color="green">экспорт</Tag>}
        </Space>
    );
}

/**
 * Список связей. `show` выбирает, какой конец связи назвать: зависимость, зависимого или оба.
 * Наведение на строку подсвечивает связь на холсте, щелчок открывает её подробности.
 */
function LinkList({ links, view, show, onHover, onSelect }: {
    readonly links: ReadonlyArray<LinkView>;
    readonly view: GraphView;
    readonly show: 'source' | 'target' | 'both';
    readonly onHover: (focus: Focus | null) => void;
    readonly onSelect: (selection: Selection) => void;
}) {
    const { token } = theme.useToken();
    const moduleName = (id: string) => view.modules.get(id)?.module.name ?? id;
    return (
        <Flex vertical style={show === 'both' ? { paddingInlineStart: token.paddingLG } : undefined}>
            {links.map((linkView) => {
                const { link } = linkView;
                const title = show === 'both' ? `${moduleName(link.sourceModuleId)} → ${moduleName(link.targetModuleId)}`
                    : moduleName(show === 'target' ? link.targetModuleId : link.sourceModuleId);
                return (
                    <HoverRow
                        key={linkView.id}
                        onHover={(hovered) => onHover(hovered ? { kind: 'link', id: linkView.id } : null)}
                        onClick={() => onSelect({ kind: 'link', id: linkView.id })}
                    >
                        <Flex gap={token.marginXS} align="center" wrap>
                            <LineSample category={linkView.category} />
                            <Typography.Text>{title}</Typography.Text>
                            {show !== 'both' && <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{linkCategoryTitles[linkView.category]}</Typography.Text>}
                            {linkView.injections.length > 0 && <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                · {linkView.injections.length} {plural(linkView.injections.length, 'внедрение', 'внедрения', 'внедрений')}
                            </Typography.Text>}
                        </Flex>
                    </HoverRow>
                );
            })}
        </Flex>
    );
}

function LinkDetails({ view, linkView, onSelect, onHover }: DetailsPanelProps & { readonly linkView: LinkView }) {
    const { token } = theme.useToken();
    const { link, injections, category } = linkView;
    const moduleName = (id: string) => view.modules.get(id)?.module.name ?? id;
    return (
        <Flex vertical gap={token.marginMD}>
            <BackButton onSelect={onSelect} />
            <Flex vertical gap={token.marginXS}>
                <Flex align="center" wrap>
                    <ModuleLink id={link.sourceModuleId} name={moduleName(link.sourceModuleId)} onHover={onHover} onSelect={onSelect} strong />
                    <Typography.Text strong style={{ marginInline: token.marginXS }}>→</Typography.Text>
                    <ModuleLink id={link.targetModuleId} name={moduleName(link.targetModuleId)} onHover={onHover} onSelect={onSelect} strong />
                </Flex>
                <Flex gap={token.marginXS} align="center">
                    <LineSample category={category} />
                    <Typography.Text strong>{linkCategoryTitles[category]}</Typography.Text>
                    {link.dynamicImport && <Tag>Динамический модуль</Tag>}
                </Flex>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{linkCategoryDescriptions[category]}</Typography.Paragraph>
            </Flex>
            <Section title="Внедрения через связь">
                {injections.length === 0
                    ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Классы модуля не получают провайдеры этого модуля напрямую." />
                    : <InjectionTable injections={injections} />}
            </Section>
        </Flex>
    );
}

function InjectionTable({ injections }: { readonly injections: ReadonlyArray<ModulesGraphInjection> }) {
    return (
        <Table
            size="small"
            pagination={false}
            rowKey={(injection) => `${linkId(injection)}:${injection.sourceClass}:${injection.place}:${injection.position}`}
            dataSource={[...injections]}
            columns={[
                { key: 'source', title: 'Кто получает', render: (_, injection) => <Typography.Text code>{injection.sourceClass}</Typography.Text> },
                { key: 'target', title: 'Что получает', render: (_, injection) => <Typography.Text code>{injection.targetClass}</Typography.Text> },
                {
                    key: 'place',
                    title: 'Как',
                    render: (_, injection) => injection.place === 'constructor'
                        ? `конструктор, параметр ${Number(injection.position) + 1}`
                        : `свойство ${injection.position}`,
                },
            ]}
        />
    );
}

/** Имя модуля в панели: наведение подсвечивает модуль на холсте, щелчок выбирает его. */
function ModuleLink({ id, name, onHover, onSelect, strong = false }: {
    readonly id: string;
    readonly name: string;
    readonly onHover: (focus: Focus | null) => void;
    readonly onSelect: (selection: Selection) => void;
    readonly strong?: boolean;
}) {
    return (
        <Typography.Link
            strong={strong}
            onMouseEnter={() => onHover({ kind: 'module', id })}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect({ kind: 'module', id })}
            style={strong ? { fontSize: 18 } : {}}
        >
            {name}
        </Typography.Link>
    );
}

/**
 * Строка панели, связанная с холстом: подсвечивается под курсором и сообщает о наведении.
 * `active` отмечает закреплённую подсветку, `disabled` — пункт, которому на графе нечего подсветить.
 */
function HoverRow({ active = false, disabled = false, onHover, onClick, children }: {
    readonly active?: boolean;
    readonly disabled?: boolean;
    readonly onHover: (hovered: boolean) => void;
    readonly onClick: () => void;
    readonly children: ReactNode;
}) {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    const setHover = (value: boolean) => {
        if (disabled) return;
        setHovered(value);
        onHover(value);
    };
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={disabled ? undefined : onClick}
            onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }}
            style={{
                padding: `${token.paddingXXS}px ${token.paddingXS}px`,
                borderRadius: token.borderRadius,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                background: active ? token.controlItemBgActive : hovered ? token.controlItemBgHover : undefined,
                transition: `background ${token.motionDurationFast}`,
            }}
        >
            {children}
        </div>
    );
}

function BackButton({ onSelect }: { readonly onSelect: (selection: Selection) => void }) {
    return <Button size="small" style={{ alignSelf: 'flex-start' }} onClick={() => onSelect(null)}>← Легенда</Button>;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <div>
            <Typography.Title level={5} style={{ marginBlockStart: 0 }}>{title}</Typography.Title>
            {children}
        </div>
    );
}

/** Образец линии связи: тот же цвет и штрих, что на холсте. */
function LineSample({ category }: { readonly category: LinkCategory }) {
    const stroke = linkStrokes[category];
    return (
        <svg width={40} height={10} style={{ flexShrink: 0 }}>
            <line x1={3} y1={5} x2={37} y2={5} stroke={stroke.color} strokeWidth={stroke.width + 1} strokeLinecap="round" strokeDasharray={stroke.dash} />
        </svg>
    );
}

/** Уменьшенный узел вида модуля: та же форма, рамка и значок, что на холсте. */
function ShapeSample({ moduleKind }: { readonly moduleKind: ModuleKind }) {
    const { token } = theme.useToken();
    const KindIcon = moduleKindIcons[moduleKind];
    return (
        <Flex
            align="center"
            justify="center"
            style={{ ...moduleShapeStyle(moduleKind, token.blue2, 26, token), width: 44, height: 26, flexShrink: 0, boxSizing: 'border-box' }}
        >
            {KindIcon !== undefined && <KindIcon />}
        </Flex>
    );
}

function isSameFocus(left: PinnedFocus, right: NonNullable<PinnedFocus>): boolean {
    if (left === null || left.kind !== right.kind) return false;
    return left.kind === 'link-category' ? left.category === (right as typeof left).category : left.moduleKind === (right as typeof left).moduleKind;
}
