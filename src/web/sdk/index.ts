/**
 * Web SDK: компоненты, хуки и типы платформы, из которых собираются экраны клиента.
 *
 * Из SDK собраны стандартные форма записи и список объекта, и из него же собираются собственные
 * экраны конфигурации. Всё, что экспортирует этот файл, считается публичным контрактом клиента:
 * экран импортирует только его, а остальные модули `src/web` остаются внутренними и могут меняться.
 *
 * В SDK входит только то, что знает о платформе: данные, права, описания объектов, вкладки, фокус.
 * Раскладку, типографику и прочие элементы без такой связи экран берёт из Ant Design напрямую,
 * обёрток для них здесь нет.
 *
 * Хуки данных SDK служат для экрана единственным путём к API. Хуки Refine и `/api/perform` экран
 * напрямую не вызывает: так сброс сохранённых ответов сервера после действия и показ ошибок
 * остаются в одном месте и не зависят от того, кто написал экран.
 *
 * Экраны пишутся обычным JSX на функциональных компонентах и хуках. Базовых классов для
 * наследования нет: клиент построен на хуках, а классовый компонент вызывать их не может.
 */

// Описания объектов с сервера. Сервер отдаёт только объекты и действия, доступные пользователю.
export type {
    FieldKind,
    FilterOperator,
    FormAction,
    FormField,
    FormGroup,
    FormTablePart,
    FormView,
    ListColumn,
    ListFilter,
    ListSort,
    ListView,
    ObjectKind,
    ObjectTarget,
    ObjectView,
    SortDirection,
    ValidationRules,
} from '../../server/ui/descriptions';
export { useObjectView } from '../data-provider/metadata';
export type { PerformTarget } from '../data-provider/perform';

// Данные: чтение списка и записи, выполнение действий.
export { ApiError } from '../common/api';
export { useAction, type ActionCall } from '../data-provider/actions';
export type { ListCondition } from '../data-provider/data-provider';
export { recordGuid, type RecordData } from '../data-provider/records';
export { useRecord, type RecordQuery } from './record';
export { defaultPageSize, useRecordList, type RecordList, type RecordListOptions } from './record-list';

// Представления записей и ссылки на них.
export { recordPresentation, recordTitle, useReferencePresentation, type ReferencePresentation } from '../references/presentation';
export { RecordLink, type RecordLinkProperties } from '../references/reference-display';

// Вкладка страницы и адреса страниц объектов.
export { newRecordPath, objectPath, recordPath } from '../common/paths';
export { useTabTitle, useUnsavedChanges, useWindowTab, type CurrentTab } from '../tabs/window-tabs';
export { Page, type PageProperties } from './page';

// Поля: ввод и отображение значения по виду поля, проверка ввода, обход с клавиатуры.
export { FieldDisplay, FieldInput, hasInput } from '../widgets/registry';
export { fieldRules, formFieldPaths, isMarkedRequired, serverRejectionMessage, validationMessage } from '../widgets/validation';
export type { DisplayProperties, FieldValues, InputHandle, InputProperties, WidgetField } from '../widgets/widget';
export { FieldGroup, type FieldGroupProperties } from './field-group';
export { useFieldTraversal, type FieldTraversal } from './field-traversal';
export { hasOpenDialog, hasOpenPicker } from './keyboard';
export { newRecordValues, recordValues, saveFields, type FormValues } from './record-values';
export { TablePart, type TablePartProperties } from './table-part';

// Действия.
export { ActionButton, actionApplies, actionSuccessMessage, type ActionButtonProperties } from './action-button';
export { ActionDialog, type ActionDialogProperties } from './action-dialog';

// Списки.
export { ListFilters, type ListFiltersProperties } from './list-filters';
export { ListSearch, type ListSearchProperties } from './list-search';
export { RecordTable, type RecordTableProperties } from './record-table';
