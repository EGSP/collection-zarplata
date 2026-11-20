/**
 * Выбор формы объекта: собственной формы конфигурации либо стандартной.
 *
 * Собственные формы попадают в клиент при сборке: реестр `object-forms.generated.ts` создаёт
 * генератор по парам файлов `*.object-form.ts` и `*.object-form-component.tsx`. Каждый вид формы
 * выбирается отдельно: собственная форма записи не заменяет форму новой записи, и наоборот.
 *
 * Форму записи и форму новой записи модуль ставит в контекст формы записи (`RecordFormHost`).
 * Через него форма подключает контракт с областью окна, и он же проверяет, что форма это сделала:
 * собственная форма без контракта показывается ошибкой, а не формой, которая молча не сообщает
 * области о записи и несохранённых изменениях.
 */
import { Button, Result } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { objectForms } from '../../configuration/object-forms.generated';
import type { ObjectFormKind } from '../../server/metadata/object-forms';
import { Pending } from '../common/pending';
import { perform, type PerformTarget } from '../data-provider/perform';
import { ObjectList } from '../lists/object-list';
import { StandardRecordForm, type FormPresentation, type FormValues, type FormView, type NewFormProperties, type ObjectView, type RecordData } from '../sdk';
import { RecordFormHostContext, type RecordFormHostValue } from '../sdk/platform/record-form-contract';
import { formElementComponent } from './form-elements';
import type { ObjectFormPropertiesByKind } from './object-form-module';

/** Ключ формы в реестре: объект и вид формы. */
function formKey(object: PerformTarget, kind: ObjectFormKind): string {
    return `${object.kind}/${object.name}/${kind}`;
}

/**
 * Общий реестр форм по объекту и виду, включая встроенные формы пользователей. Повторы и неверные цели отклоняет сервер
 * при запуске, поэтому файл без объявления здесь пропускается: с такой конфигурацией сервер не запустится.
 */
const components: ReadonlyMap<string, ComponentType<never>> = new Map(
    objectForms.flatMap(module => module.definition === undefined ? [] : [[formKey(module.definition.object, module.definition.kind), module.component] as const]),
);

/** Компонент формы объекта нужного вида: собственный из конфигурации либо стандартный. */
function objectFormComponent<Kind extends ObjectFormKind>(object: PerformTarget, kind: Kind, standard: ComponentType<ObjectFormPropertiesByKind[Kind]>): ComponentType<ObjectFormPropertiesByKind[Kind]> {
    // Реестр проверил свойства компонента по виду формы в объявлении, а ключ содержит этот вид.
    return (components.get(formKey(object, kind)) as ComponentType<ObjectFormPropertiesByKind[Kind]> | undefined) ?? standard;
}

/** Список объекта: собственная форма списка либо стандартный список. */
export function ObjectListForm({ object }: { readonly object: ObjectView }) {
    const List = objectFormComponent(object, 'list', ObjectList);
    return <List object={object} />;
}

/** Свойства формы записи объекта. */
interface ObjectRecordFormProperties {
    readonly object: ObjectView;
    readonly view: FormView;
    /** Запись, с которой открыта форма; у формы новой записи `null`. */
    readonly record: RecordData | null;
    /** Повторное чтение записи; у формы новой записи `null`. */
    readonly reload: (() => Promise<RecordData>) | null;
    readonly presentation: FormPresentation;
    /** Значения новой записи от того, кто открыл форму; у существующей записи не учитываются. */
    readonly default?: FormValues | undefined;
}

/**
 * Форма записи или новой записи объекта в контексте формы записи. Вид формы определяется записью:
 * без записи открывается форма новой записи.
 */
export function ObjectRecordForm({ object, view, record, reload, presentation, default: defaults }: ObjectRecordFormProperties) {
    if (record === null || reload === null) {
        const New = objectFormComponent(object, 'new', StandardRecordForm);
        return <PreparedNewRecordForm object={object} view={view} presentation={presentation} default={defaults} component={New} />;
    }
    const Existing = objectFormComponent(object, 'record', StandardRecordForm);
    return (
        <RecordFormHost object={object} record={record}>
            <Existing object={object} view={view} record={record} reload={reload} presentation={presentation} />
        </RecordFormHost>
    );
}

/** Открывает форму один раз с полным ответом сервера; ожидание и ошибка занимают только её область. */
function PreparedNewRecordForm({ object, view, presentation, default: defaults, component: New }: NewFormProperties & {
    readonly component: ComponentType<NewFormProperties>;
}) {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<FormValues | Error | null>(null);
    const { kind, name } = object;
    useEffect(() => {
        let active = true;
        // Даём Strict Mode завершить проверочное монтирование до отправки запроса.
        queueMicrotask(() => {
            if (!active) return;
            void perform<FormValues>({
                target: { kind: 'platform', name: 'records' },
                action: 'prepareNewRecord',
                payload: { object: { kind, name }, default: defaults },
            }).then(
                values => { if (active) setResult(values); },
                error => { if (active) setResult(error instanceof Error ? error : new Error('Не удалось загрузить начальные значения')); },
            );
        });
        return () => { active = false; };
    }, [kind, name, defaults, attempt]);

    if (result === null) return <Pending label="Загружаем начальные значения" />;
    if (result instanceof Error) {
        return <Result status="error" title="Не удалось загрузить начальные значения" subTitle={result.message} extra={
            <Button type="primary" onClick={() => { setResult(null); setAttempt(attempt + 1); }}>Повторить</Button>
        } />;
    }
    return (
        <RecordFormHost object={object} record={null}>
            <New object={object} view={view} presentation={presentation} default={result} />
        </RecordFormHost>
    );
}

interface RecordFormHostProperties {
    readonly object: ObjectView;
    readonly record: RecordData | null;
    readonly children: ReactNode;
}

/**
 * Контекст формы записи и проверка контракта. Эффекты потомков выполняются раньше эффектов
 * родителя, поэтому к эффекту контекста форма, вызвавшая `useRecordFormContract`, уже отметилась.
 * Отметка ведётся счётчиком: две формы в одном контексте сообщали бы области о записи дважды.
 */
function RecordFormHost({ object, record, children }: RecordFormHostProperties) {
    const registered = useRef(0);
    const [problem, setProblem] = useState<string | null>(null);
    const register = useCallback(() => {
        registered.current += 1;
        return () => {
            registered.current -= 1;
        };
    }, []);
    const value = useMemo<RecordFormHostValue>(
        () => ({ object: { kind: object.kind, name: object.name }, record, elements: formElementComponent, register }),
        // Запись нужна только при открытии: дальше форма ведёт записанное состояние сама,
        // и новая запись в зависимостях пересоздала бы контекст без причины.
        [object.kind, object.name, register],
    );
    useEffect(() => {
        if (registered.current === 0) setProblem('Компонент формы не подключил контракт с областью окна: вызовите в нём useRecordForm или useRecordFormContract.');
        else if (registered.current > 1) setProblem('Контракт с областью окна подключён в форме несколько раз: о записи область узнала бы дважды.');
    }, []);
    if (problem !== null) return <Result status="error" title={`Форма «${object.title}» не может быть показана`} subTitle={problem} />;
    return <RecordFormHostContext value={value}>{children}</RecordFormHostContext>;
}
