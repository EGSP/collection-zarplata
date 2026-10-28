/**
 * Web SDK: компоненты, хуки и типы платформы, из которых собираются экраны клиента.
 *
 * Из SDK собраны стандартные форма записи и список объекта, и из него же собираются собственные
 * экраны конфигурации. Всё, что экспортирует этот файл, считается публичным контрактом клиента:
 * экран импортирует только его, а остальные модули `src/web` остаются внутренними и могут меняться.
 *
 * Модули SDK разложены по слоям дизайн-системы: `ds` — основа (сетка, колонка, стек, шкала
 * отступов, иконки, плитка, кнопка, поверхности, текст, смысловые цвета, таблица данных), `derivations` —
 * компоненты, собранные из `ds`, например кнопка главного действия формы, `external` — компоненты,
 * которые пока не следуют правилам дизайн-системы, `platform` — блоки, которые знают о платформе:
 * данные, права, описания объектов, область окна, фокус. Раскладку экран строит компонентами `ds`;
 * контролы, которых в `ds` пока нет, берёт из Ant Design напрямую.
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
    ActionConfirmation,
    ActionConfirmationTone,
    ActionPlacement,
    FieldKind,
    FilterOperator,
    FormAction,
    FormElementReference,
    FormField,
    FormGroup,
    FormTablePart,
    FormView,
    InputMode,
    ListColumn,
    ListFilter,
    ListSort,
    ListView,
    ObjectKind,
    ObjectTarget,
    ObjectView,
    PageView,
    RecordOpeningMode,
    SortDirection,
    ValidationRules,
} from '../../server/ui/descriptions';
export { ReadOnlyTablePart, RecordTablePart, type ReadOnlyTablePartProperties, type RecordTablePartProperties, type RecordTableSelection } from './platform/record-table-part';
export { useObjectView, usePageView } from '../data-provider/metadata';
export type { PerformTarget } from '../data-provider/perform';

// Ссылки на объекты конфигурации: по ним компилятор проверяет имена полей и действий.
export type { ActedObject, FieldName, ListedObject, ObjectReference, ReadObject, RecordCondition, RecordSort } from './platform/object-reference';

// Данные: чтение списка и записи, выполнение действий.
export { ApiError } from '../common/api';
export { useAction, useActionResult, type ActionCall, type ActionQuery, type ActionResult } from '../data-provider/actions';
export type { ListCondition } from '../data-provider/data-provider';
export { recordGuid, type RecordData } from '../data-provider/records';
export { useRecord, useRecords, type RecordQuery, type RecordsQuery } from './platform/record';
export { defaultPageSize, useRecordList, type RecordList, type RecordListOptions } from './platform/record-list';

// Представления записей и ссылки на них.
export { listRecordPresentation, recordPresentation, recordTitle, useRecordPresentation, useReferencePresentation, type ReferencePresentation } from '../references/presentation';
export { RecordLink, type RecordLinkProperties } from '../references/reference-display';

// Область окна страницы, открытие формы записи, адреса страниц объектов и собственных страниц конфигурации.
export { newRecordPath, objectPath, pagePath, recordPath } from '../common/paths';
export { useOpenRecord, type OpenRecord } from './platform/open-record';
export { useUnsavedChanges, useWindowScope, useWindowTitle, type WindowScope } from '../window/window-scope';
export { Page, type PageProperties } from './platform/page';

// Поля: ввод и отображение значения по виду поля, проверка ввода, обход с клавиатуры.
export { FieldDisplay, FieldInput, compositeInputs, hasInput } from '../widgets/registry';
export { fieldRules, formFieldPaths, isMarkedRequired, serverRejectionMessage, validationMessage } from '../widgets/validation';
export type { CompositeInputModes, CompositeInputProperties, DateLimits, DisplayProperties, FieldValues, InputHandle, InputProperties, WidgetField } from '../widgets/widget';
export { FieldGroup, type FieldGroupProperties } from './platform/field-group';
export { FormStack, type FormStackProperties } from './platform/form-stack';
export { FluidField, FluidValue, fieldInput, type FieldInputComponent, type FieldInputLayouts, type FieldInputMark, type FieldLayout, type FluidFieldProperties, type FluidValueProperties, type FluidInputProperties, type LaidOutInputProperties } from './platform/field-layout';
export { FormDataProvider, useFormData, useFormRestrictions, useFormValue, type EnteredValue, type FormData, type FormDataProviderProperties, type FormElementComponent, type SetValueOptions } from './platform/form-data';
export { useFormRestrictionRegistry, type FormRestrictionRegistry, type FormRestrictions } from './platform/form-restrictions';
export { useFieldTraversal, type FieldTraversal } from './platform/field-traversal';
export { hasOpenDialog, hasOpenPicker } from './platform/keyboard';
export { newRecordValues, newRowValues, recordValues, saveFields, type FormValues } from './platform/record-values';
export { TablePart, TablePartTitle, type TablePartOptions, type TablePartProperties } from './platform/table-part';

// Формы объекта: свойства форм, контракт формы записи с областью окна и части стандартной формы записи.
export type { FormPresentation, ListFormProperties, NewFormProperties, RecordFormProperties } from './platform/object-form-properties';
export { useRecordFormContract, type RecordFormActionInput, type RecordFormController, type RecordFormHandlers, type RecordFormOutcome, type RecordFormRunOptions } from './platform/record-form-contract';
export {
    RecordFormActions,
    RecordFormBody,
    RecordFormLayout,
    RecordFormMarks,
    RecordFormPage,
    StandardRecordForm,
    recordFormElements,
    useRecordForm,
    type RecordFormActionsProperties,
    type RecordFormBodyProperties,
    type RecordFormButtons,
    type RecordFormLayoutProperties,
    type RecordFormOptions,
    type RecordFormPageProperties,
    type RecordFormPartProperties,
    type RecordFormState,
    type RecordFormTitles,
} from './platform/record-form';

// Раскладка: сетка, колонка, стек и шкала отступов по правилам Carbon.
export { Grid, Column, type GridProperties, type ColumnProperties, type ColumnCount } from './ds/grid';
export { Stack, type StackProperties } from './ds/stack';
export { spacing, breakpoints, breakpointWidths, gridColumns, type SpacingStep, type Breakpoint, type GridGutter, type PageModel } from './ds/layout';
export { BreakpointContainer, useBreakpoint, breakpointAtLeast, type BreakpointContainerProperties } from './ds/breakpoints';

// Таблица данных: типы ячеек, колонки по размерам в знаках и долях, составные колонки по точкам перелома.
export { DataTable, type DataTableColumn, type DataTableExpansion, type DataTableProperties, type DataTableRowState, type DataTableSelection, type DataTableSortDirection } from './ds/data-table';
export { columnGroups, tableLayoutAt, type ColumnSize, type ControlColumnSize, type TableLayout, type TableLayouts } from './ds/table-layout';
export { CellTextInput, cellAlign, cellColumnSize, cellTextRules, cellTypes, formatCell, hasTextInput, listCellMinimum, type TextConversion, type CellInputOptions, type CellTextInputHandle, type CellTextInputProperties, type CellType, type PrimitiveCellType } from './ds/cell-types';
export { CellComboInput, type CellComboInputProperties, type CellOption } from './ds/cell-combo';
export { fieldCellType, fieldColumn, fieldColumnSize, type CellField } from './platform/field-cells';

// Иконки по смыслу: добавление, открытие, удаление и прочие; крупные пиктограммы разделов.
export { Icons, type IconName } from './ds/icons';
export { Pictograms, type PictogramName } from './ds/pictograms';

// Плитка перехода к странице.
export { Tile, type TileProperties } from './ds/tile';

// Кнопки с размерами Carbon и кнопка главного действия формы.
export { Button, type ButtonProperties, type ButtonSize } from './ds/button';
export { MainActionButton, type MainActionButtonProperties } from './derivations/main-action-button';

// Поверхности по уровням вложенности, роли текста и смысловые цвета учёта.
export { Layer, Panel, useLayer, type LayerColors, type LayerLevel, type LayerProperties, type PanelProperties } from './ds/layer';
export { Text, type TextCommonProperties, type TextHeadingProperties, type TextHeadingVariant, type TextProperties, type TextTone } from './ds/text';
export { useAccountingColors, type AccountingColor, type AccountingTone } from './ds/colors';

// Действия.
export { ActionButton, actionApplies, actionSuccessMessage, type ActionButtonProperties } from './platform/action-button';
export { ActionDialog, type ActionDialogProperties } from './platform/action-dialog';
export { ActionConfirmationDialog, useActionConfirmation, type ActionConfirmationDialogProperties, type ActionConfirmationState } from './platform/action-confirmation';

// Списки.
export { ListFilters, type ListFiltersProperties } from './platform/list-filters';
export { ListSearch, type ListSearchProperties } from './platform/list-search';
export { RecordTable, type RecordTableProperties } from './platform/record-table';

// Клиентские группы и управление действиями стандартного списка.
export { defineShellGroups, shellGroup, ShellGroups, type ShellGroup, type ShellGroupComponent, type ShellGroupEntry } from './platform/shell-groups';
export { ListControlsProvider, useListControls, useListControlsState, type ListControls } from './platform/list-controls';
export { ShellGroupContent, ShellGroupsProvider } from './platform/shell-group-content';

/** Контракт замены табличной части и проверка строк без отрисовки таблицы. */
export { tablePartValidationMessages, type TablePartInputProperties } from './platform/table-part-input';
