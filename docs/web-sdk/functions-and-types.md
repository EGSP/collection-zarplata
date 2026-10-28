---
covers:
  - src/web/sdk/index.ts
  - src/web/sdk/platform/object-form-properties.ts
---

# Функции и типы Web SDK

## Функции и значения

| Что | Назначение |
|---|---|
| `objectPath`, `recordPath`, `newRecordPath`, `pagePath` | Адреса списка, формы записи и страницы конфигурации |
| `ShellGroups`, `shellGroup`, `defineShellGroups` | Места платформы, собственные группы и состав групп |
| `recordGuid`, `recordTitle`, `recordPresentation` | Идентификатор, заголовок и собственное представление записи |
| `listRecordPresentation` | Представление записи из страницы списка с учётом представлений ссылок; для упорядочивания по представлению на клиенте |
| `recordFormElements` | Элементы группы [стандартной формы](components.md#стандартная-форма-и-её-части) для `FieldGroup` без служебных полей новой записи |
| `newRecordValues`, `recordValues`, `saveFields`, `newRowValues` | Начальные значения формы и строки, значения записи, данные для `save` |
| `fieldRules`, `formFieldPaths`, `isMarkedRequired`, `validationMessage`, `serverRejectionMessage`, `tablePartValidationMessages` | Проверка полей и строк, сопоставление ошибок сервера с полями |
| `hasInput`, `hasOpenPicker`, `hasOpenDialog` | Есть ли ввод в поле, открыт ли выбор или модальное окно |
| `actionApplies`, `actionSuccessMessage` | Применимость действия к записи и текст успешного выполнения |
| `defaultPageSize` | Размер страницы списка по умолчанию |
| `ApiError` | Отказ API: статус, сообщение, поля и право |
| `fieldInput`, `FluidField`, `FluidValue` | Сборка собственного поля ввода для обеих [компоновок](components.md#компоновка-полей), обёртка поля с подписью в сегменте и сегмент значения не из Ant Design |
| `FormStack` | [Стек элементов формы](components.md#форма-из-formitem) из `Form.Item` без нижнего отступа |
| `useActionConfirmation` | [Запрос подтверждения действия](hooks.md#выполнение-действий): `confirm(action)` и окно `dialog` |
| `spacing`, `breakpoints`, `breakpointWidths`, `gridColumns` | Значения раскладки: [шкала отступов, точки перелома](../components.md#шкала-отступов-и-стек), их ширины и число колонок |
| `useBreakpoint`, `breakpointAtLeast` | [Точка перелома](../components.md#точка-перелома-в-коде) ближайшего `BreakpointContainer` и проверка «не уже заданной точки»; вне контейнеров действует `sm` |
| `useAccountingColors` | [Смысловые цвета учёта](hooks.md#поверхность-и-цвета) текущей темы |
| `useLayer` | [Уровень и фоны](hooks.md#поверхность-и-цвета) ближайшей поверхности |
| `columnGroups`, `tableLayoutAt` | Правила [схем отображения](../components.md#составные-колонки-и-схемы-отображения): колонки по схеме и схема для точки перелома |
| `fieldCellType`, `fieldColumn`, `fieldColumnSize` | [Тип ячейки и размер колонки](../components.md#размер-колонки-в-знаках-и-долях) по виду поля: `fieldColumn` отдаёт тип и размер вместе, `fieldColumnSize` размер либо `undefined`, если подходит размер типа |
| `cellTypes`, `cellAlign`, `cellColumnSize`, `formatCell`, `hasTextInput` | Правила [типов ячеек](../components.md#типы-ячеек): выравнивание, размер по типу и заголовку, текст значения, вводится ли тип текстом |
| `cellTextRules`, `listCellMinimum` | Правила ввода типа текстом (`TextConversion`) для полей поверх собственного `input` и наименьший размер колонки со списком, 16 знаков |
| `CellTextInput` | Собственное поле ячейки для строки, числа и суммы |
| `CellComboInput` | [Поле ячейки со списком](../components.md#ячейка-табличной-части): собственный `input` и список вариантов под ячейкой; варианты и выбор передаёт платформа |
| `Icons`, `Pictograms` | [Реестры значков](../web-sdk.md#иконки-и-пиктограммы) |

`hasOpenDialog` принимает корневой элемент экрана и не учитывает окно, в котором показан сам экран. Иначе форма в модальном окне сочла бы себя перекрытой собственным окном и отключила бы сочетания клавиш.

## Типы

| Типы | Назначение |
|---|---|
| `ObjectView`, `FormView`, `ListView`, `FormField`, `FormAction` и связанные | Описания объектов с сервера |
| `ActionPlacement`, `ActionConfirmation`, `ActionConfirmationTone` | Место показа действия (`buttons`, `more`, `hidden`) и настройка его окна подтверждения (`delay`, `title`, `message`, `tone`) |
| `ActionResult`, `ActionConfirmationState`, `ActionConfirmationDialogProperties` | Результат [`useActionResult`](hooks.md#выполнение-действий) с `refresh`, результат `useActionConfirmation` и свойства [окна подтверждения](components.md#подтверждение-действия) |
| `ObjectReference`, `FieldName`, `RecordCondition`, `RecordSort` и связанные | [Ссылки на объекты](../web-sdk.md#типизация-объектов) с точными типами записи и действий |
| `BreakpointContainerProperties` | Свойства `BreakpointContainer`: `of="window"`, `of="fixed"` с `point` или `of="element"` с `style` |
| `SpacingStep`, `Breakpoint`, `GridGutter`, `PageModel`, `ColumnCount` | Шаг шкалы отступов, точка перелома, режим зазора сетки, [модель страницы](../components.md#модели-страницы) и число колонок по точкам |
| `ObjectTarget`, `PerformTarget`, `ListCondition` | Объект и условия запроса |
| `RecordData`, `FormValues` | Запись общего типа и значения формы |
| `RecordQuery`, `RecordsQuery` | Результат [`useRecord`](hooks.md#чтение-данных) и [`useRecords`](hooks.md#чтение-данных): записи, `loading` и `error` |
| `InputProperties`, `DisplayProperties`, `CompositeInputModes` и связанные | Контракт поля ввода и отображения |
| `DateLimits` | Включительные границы `minimum` и `maximum` для календарной даты (`YYYY-MM-DD`); применяются через `FieldInput.dateLimits` и по именам полей в `ActionDialog.dateLimits` |
| `TablePartInputProperties` | Контракт замены табличной части |
| `ListFormProperties`, `RecordFormProperties`, `NewFormProperties`, `FormPresentation` | Свойства форм объекта и место показа `page` или `dialog` ([«Формы объекта»](../metadata.md#формы-объекта)) |
| `RecordFormHandlers`, `RecordFormController`, `RecordFormOutcome`, `RecordFormRunOptions` | Обработчики, управление и итог действия [контракта формы записи](hooks.md#контракт-формы-записи) |
| `RecordFormState`, `RecordFormPartProperties`, `RecordFormBodyProperties`, `RecordFormLayoutProperties`, `RecordFormPageProperties`, `RecordFormActionsProperties` | Состояние `useRecordForm` и свойства [частей формы](components.md#стандартная-форма-и-её-части) |
| `RecordFormTitles`, `RecordFormButtons` | [Подписи](components.md#подписи-кнопок) и [набор кнопок](components.md#набор-кнопок) формы: действия по именам, «Провести и закрыть», «Закрыть» |
| `RecordFormOptions`, `RecordFormActionInput` | Настройки [`useRecordForm`](hooks.md#userecordform) (`beforeSave`, `atomicPosting`) и входные данные `run`: значения либо функция от записанной записи |
| `SetValueOptions` | Параметры `FormData.setValue`: `validate: false` откладывает проверку ([«Данные формы»](hooks.md#данные-формы)) |
| `FieldLayout`, `FieldInputComponent`, `FieldInputLayouts`, `FieldInputMark`, `FluidInputProperties`, `LaidOutInputProperties` | [Компоновка полей](components.md#компоновка-полей) и контракт собственного поля ввода |
| `FluidValueProperties`, `FormStackProperties` | Свойства [сегмента значения](components.md#компоновка-полей) fluid-поля (`content`) и [стека формы](components.md#форма-из-formitem) (`gap`) |
| `ButtonSize`, `ButtonProperties`, `MainActionButtonProperties` | Размер [кнопки](components.md#кнопки) `sm`, `md`, `lg`, `xl` и свойства кнопок |
| `LayerLevel`, `LayerColors`, `LayerProperties`, `PanelProperties` | Уровень [поверхности](components.md#поверхности) (0–3), фоны уровня и свойства `Layer` и `Panel` |
| `TextTone`, `TextHeadingVariant`, `TextProperties`, `TextHeadingProperties`, `TextCommonProperties` | Цвет и ступень заголовка [ролей текста](components.md#роли-текста) и их свойства |
| `AccountingTone`, `AccountingColor` | Смысловой цвет учёта (`total`, `debt`, `overpayment`, `warning`) и его оттенки: `text`, `solid`, `solidHover`, `background`, `backgroundStrong` |
| `TablePartOptions` | [Настройки вида табличной части](components.md#табличная-часть) |
| `DataTableProperties`, `DataTableColumn`, `DataTableSelection`, `DataTableExpansion`, `DataTableRowState`, `DataTableSortDirection` | Свойства и части [таблицы данных](../components.md#таблица-данных) |
| `ColumnSize`, `ControlColumnSize`, `TableLayout`, `TableLayouts` | Размер колонки в знаках и долях, размер служебной колонки `'control'`, схема отображения и схемы по точкам перелома |
| `CellType`, `PrimitiveCellType`, `CellInputOptions`, `CellTextInputHandle`, `CellTextInputProperties`, `TextConversion`, `CellComboInputProperties`, `CellOption`, `CellField` | Тип ячейки (`string`, `number`, `money`, `date`, `dateTime`, `boolean`, `free`) и его примитивная часть, ограничения ввода (`integer`, `maximumLength`), управление и свойства поля ячейки, перевод значения в текст и обратно, свойства поля со списком и его вариант (`key`, `label`), поле для расчёта типа |
| `ReadOnlyTablePartProperties` | Свойства `ReadOnlyTablePart` |
| `<Компонент>Properties` | Свойства компонента SDK, например `TileProperties` |
