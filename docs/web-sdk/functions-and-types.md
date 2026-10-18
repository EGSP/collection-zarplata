---
covers:
  - src/web/sdk/index.ts
  - src/web/sdk/object-form-properties.ts
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
| `fieldInput`, `FluidField` | Сборка собственного поля ввода для обеих [компоновок](components.md#компоновка-полей) и обёртка поля с подписью в сегменте |
| `useActionConfirmation` | [Запрос подтверждения действия](hooks.md#выполнение-действий): `confirm(action)` и окно `dialog` |
| `Icons`, `Pictograms` | [Реестры значков](../web-sdk.md#иконки-и-пиктограммы) |

`hasOpenDialog` принимает корневой элемент экрана и не учитывает окно, в котором показан сам экран. Иначе форма в модальном окне сочла бы себя перекрытой собственным окном и отключила бы сочетания клавиш.

## Типы

| Типы | Назначение |
|---|---|
| `ObjectView`, `FormView`, `ListView`, `FormField`, `FormAction` и связанные | Описания объектов с сервера |
| `ActionPlacement`, `ActionConfirmation`, `ActionConfirmationTone` | Место показа действия (`buttons`, `more`, `hidden`) и настройка его окна подтверждения (`delay`, `title`, `message`, `tone`) |
| `ActionResult`, `ActionConfirmationState`, `ActionConfirmationDialogProperties` | Результат [`useActionResult`](hooks.md#выполнение-действий) с `refresh`, результат `useActionConfirmation` и свойства [окна подтверждения](components.md#подтверждение-действия) |
| `ObjectReference`, `FieldName`, `RecordCondition`, `RecordSort` и связанные | [Ссылки на объекты](../web-sdk.md#типизация-объектов) с точными типами записи и действий |
| `ObjectTarget`, `PerformTarget`, `ListCondition` | Объект и условия запроса |
| `RecordData`, `FormValues` | Запись общего типа и значения формы |
| `RecordQuery`, `RecordsQuery` | Результат [`useRecord`](hooks.md#чтение-данных) и [`useRecords`](hooks.md#чтение-данных): записи, `loading` и `error` |
| `InputProperties`, `DisplayProperties`, `CompositeInputModes` и связанные | Контракт поля ввода и отображения |
| `TablePartInputProperties` | Контракт замены табличной части |
| `ListFormProperties`, `RecordFormProperties`, `NewFormProperties`, `FormPresentation` | Свойства форм объекта и место показа `page` или `dialog` ([«Формы объекта»](../metadata.md#формы-объекта)) |
| `RecordFormHandlers`, `RecordFormController`, `RecordFormOutcome`, `RecordFormRunOptions` | Обработчики, управление и итог действия [контракта формы записи](hooks.md#контракт-формы-записи) |
| `RecordFormState`, `RecordFormPartProperties`, `RecordFormBodyProperties`, `RecordFormLayoutProperties`, `RecordFormPageProperties`, `RecordFormActionsProperties` | Состояние `useRecordForm` и свойства [частей формы](components.md#стандартная-форма-и-её-части) |
| `RecordFormTitles`, `RecordFormButtons` | [Подписи](components.md#подписи-кнопок) и [набор кнопок](components.md#набор-кнопок) формы: действия по именам, «Провести и закрыть», «Закрыть» |
| `RecordFormOptions`, `RecordFormActionInput` | Настройки [`useRecordForm`](hooks.md#userecordform) (`beforeSave`, `atomicPosting`) и входные данные `run`: значения либо функция от записанной записи |
| `SetValueOptions` | Параметры `FormData.setValue`: `validate: false` откладывает проверку ([«Данные формы»](hooks.md#данные-формы)) |
| `FieldLayout`, `FieldInputComponent`, `FieldInputLayouts`, `FieldInputMark`, `FluidInputProperties`, `LaidOutInputProperties` | [Компоновка полей](components.md#компоновка-полей) и контракт собственного поля ввода |
| `TablePartOptions` | [Настройки вида табличной части](components.md#табличная-часть) |
| `<Компонент>Properties` | Свойства компонента SDK, например `TileProperties` |
