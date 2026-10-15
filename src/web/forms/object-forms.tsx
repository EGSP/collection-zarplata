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
import { Result } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { objectForms } from '../../configuration/object-forms.generated';
import type { ObjectFormKind } from '../../server/metadata/object-forms';
import type { PerformTarget } from '../data-provider/perform';
import { ObjectList } from '../lists/object-list';
import { StandardRecordForm, type FormPresentation, type FormValues, type FormView, type ObjectView, type RecordData } from '../sdk';
import { RecordFormHostContext, type RecordFormHostValue } from '../sdk/record-form-contract';
import { formElementComponent } from './form-elements';
import type { ObjectFormPropertiesByKind } from './object-form-module';

/** Ключ формы в реестре: объект и вид формы. */
function formKey(object: PerformTarget, kind: ObjectFormKind): string {
    return `${object.kind}/${object.name}/${kind}`;
}

/**
 * Компоненты собственных форм по объекту и виду. Повторы и неверные цели отклоняет сервер
 * при запуске, поэтому файл без объявления здесь пропускается: с такой конфигурацией сервер не запустится.
 */
const components: ReadonlyMap<string, ComponentType<never>> = new Map(
    objectForms.flatMap((module) => (module.definition === undefined ? [] : [[formKey(module.definition.object, module.definition.kind), module.component] as const])),
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
    readonly initial?: FormValues | undefined;
}

/**
 * Форма записи или новой записи объекта в контексте формы записи. Вид формы определяется записью:
 * без записи открывается форма новой записи.
 */
export function ObjectRecordForm({ object, view, record, reload, presentation, initial }: ObjectRecordFormProperties) {
    if (record === null || reload === null) {
        const New = objectFormComponent(object, 'new', StandardRecordForm);
        return (
            <RecordFormHost object={object} record={null}>
                <New object={object} view={view} presentation={presentation} initial={initial} />
            </RecordFormHost>
        );
    }
    const Existing = objectFormComponent(object, 'record', StandardRecordForm);
    return (
        <RecordFormHost object={object} record={record}>
            <Existing object={object} view={view} record={record} reload={reload} presentation={presentation} />
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
