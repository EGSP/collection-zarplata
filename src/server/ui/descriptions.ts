/**
 * Формат описаний форм и списков (SDUI), которые сервер отдаёт через `GET /api/metadata`.
 *
 * Клиент строит формы и списки только по этим описаниям и импортирует этот файл напрямую.
 * Поэтому здесь нет импортов Nest и Effect: клиентская сборка не должна тянуть серверные пакеты.
 * Единственный импорт — типы из описаний метаданных, у которых собственных импортов тоже нет.
 * Отсюда же сервер берёт названия способов сравнения и направлений сортировки для действия `list`.
 *
 * Описание уже учитывает переопределения формы из конфигурации: клиенту не нужно знать,
 * что задано по умолчанию, а что переопределено.
 */
import type { Formula } from '../../common/formulas.js';
import type { ValueSuggestions } from '../metadata/descriptions.js';
import type { DelegatedPresentation, FieldKind, FieldRole, FieldWidth, FormElementReference, InputMode, ObjectKind, ObjectTarget, RecorderValue, RecordOpeningMode } from '../metadata/descriptions.js';

export type { DelegatedPresentation, FieldKind, FieldWidth, FormElementReference, InputMode, ObjectKind, ObjectTarget, RecorderValue, RecordOpeningMode };

/**
 * Правила проверки значения поля. Клиент проверяет по ним ввод до отправки, окончательную
 * проверку выполняет сервер по тем же метаданным.
 */
export interface ValidationRules {
    /** Значение должно быть заполнено; обязательная строка к тому же не может быть пустой. */
    readonly required: boolean;
    /** Минимальная длина строки в символах UTF-16, как `String.length`. */
    readonly minimumLength: number | null;
    readonly maximumLength: number | null;
    /** Нижняя граница числа; у денег — в копейках. */
    readonly minimum: number | null;
    /** Верхняя граница числа; у денег — в копейках. */
    readonly maximum: number | null;
    /** Разрешены только целые числа. У денег всегда `true`: значение хранится в копейках. */
    readonly integer: boolean;
}

/**
 * Поле формы, колонка табличной части или поле входных данных действия.
 * Значение поля вида `money` — целое число копеек; перевод в рубли для показа выполняет клиент.
 */
export interface FormField {
    readonly name: string;
    /** Подпись с учётом переопределения формы. */
    readonly title: string;
    readonly kind: FieldKind;
    /** Объект, из которого выбирается значение ссылки; заполнен только у полей вида `reference`. */
    readonly target: ObjectTarget | null;
    /** Допустимые строковые значения для выбора. */
    readonly choices?: ReadonlyArray<string> | null;
    /** Значение строки в новой записи или новой строке вместо пустого. */
    readonly initial?: string | null;
    /** Значение заполняет платформа: поле показывается, но не редактируется и не входит в порядок обхода. */
    readonly readOnly: boolean;
    readonly computed?: Formula | null;
    readonly suggestions?: ValueSuggestions | null;
    readonly expandedTablePart?: string | null;
    /**
     * Варианты составного поля в порядке объявления. Каждый вариант описан как поле своего вида:
     * по нему клиент выбирает виджет ввода и показа и проверяет значение варианта.
     */
    readonly variants?: ReadonlyArray<FormField> | null;
    /** Способ ввода: `fluent` — значение пишется текстом, `solid` — нужен собственный элемент ввода. */
    /** Ширина поля ввода на форме из конфигурации; без неё обычная. Форма может задать другую. */
    readonly width?: FieldWidth;
    readonly inputMode?: InputMode;
    readonly rules: ValidationRules;
    /**
     * Имя собственного элемента конфигурации, который на форме служит полем ввода вместо виджета
     * вида поля. Заполнено только у поля шапки, которому компонент назначен через override своего объявления.
     */
    readonly inputElement: string | null;
}

/** Табличная часть формы: колонки — поля одной строки в порядке объявления. */
export interface FormTablePart {
    /** Компонент вместо стандартной таблицы; отсутствие означает стандартное представление. */
    readonly inputElement?: string | null;
    readonly name: string;
    readonly title: string;
    readonly columns: ReadonlyArray<FormField>;
}

/**
 * Группа элементов формы. `elements` перечисляет их в порядке показа. Строка — имя поля или
 * табличной части; их описания лежат в `fields` и `tableParts` формы. Объект `{ element }` —
 * собственный элемент конфигурации: его компонент клиент находит по имени в своём реестре.
 * Группа без заголовка (`title: null`) показывается без рамки: в неё попадают поля и табличные
 * части, которые конфигурация не распределила по группам.
 */
export interface FormGroup {
    readonly title: string | null;
    readonly elements: ReadonlyArray<string | FormElementReference>;
}

/**
 * Действие, которое форма предлагает пользователю. `standard` отличает стандартные действия
 * платформы (`save`, `post` и другие) от собственных действий объекта. У стандартных действий
 * `input` пуст: их входные данные — сама запись формы.
 */
export interface FormAction {
    readonly name: string;
    readonly title: string;
    readonly standard: boolean;
    readonly input: ReadonlyArray<FormField>;
    readonly tableParts?: ReadonlyArray<FormTablePart>;
}

/**
 * Описание формы объекта. Форма есть у справочников и документов; строки регистров записывают
 * только документы при проведении, поэтому формы регистра нет.
 */
export interface FormView {
    /** Полный состав для формул, включая скрытые элементы; их значения берутся из записанного состояния. */
    readonly calculations?: { readonly fields: ReadonlyArray<FormField>; readonly tableParts: ReadonlyArray<FormTablePart> };
    /** Поля, которые выводятся на форму, в порядке объявления. Скрытых полей здесь нет. */
    readonly fields: ReadonlyArray<FormField>;
    /** Табличные части, которые выводятся на форму, в порядке объявления. */
    readonly tableParts: ReadonlyArray<FormTablePart>;
    /** Раскладка формы: каждое поле и каждая табличная часть входят ровно в одну группу. */
    readonly groups: ReadonlyArray<FormGroup>;
    /**
     * Порядок обхода с клавиатуры: имена редактируемых полей и табличных частей. Следует
     * за раскладкой групп; поля только для чтения и собственные элементы в группах пропускаются.
     * Табличная часть — одна остановка, внутри неё клиент обходит ячейки сам. Поле, которому
     * назначен собственный элемент, остаётся в порядке на своём месте.
     */
    readonly traversal: ReadonlyArray<string>;
    /**
     * Действия формы в порядке показа. В ответе сервера остаются только действия, на которые
     * у пользователя есть право; форму без действия `save` клиент показывает только для просмотра.
     */
    readonly actions: ReadonlyArray<FormAction>;
    /**
     * Режим, в котором форма новой записи открывается, когда место вызова режим не указало.
     * Существующая запись без указания режима открывается во вкладке.
     */
    readonly creationMode: RecordOpeningMode;
}

/** Вариант составной колонки или отбора: вид значения, цель ссылки и перечень значений строки. */
export interface ListVariant {
    readonly kind: FieldKind;
    readonly target: ObjectTarget | null;
    readonly choices?: ReadonlyArray<string> | null;
    /** Правила нужны полю ввода отбора, например запрет дробной части целого числа. */
    readonly rules: ValidationRules;
}

/** Колонка списка: поле записи. */
export interface ListColumn {
    /** Роль поля позволяет отличить измерения ключа от ресурсов регистра. */
    readonly role: FieldRole;
    readonly field: string;
    readonly title: string;
    readonly kind: FieldKind;
    readonly target: ObjectTarget | null;
    /** Допустимые строковые значения для выбора. */
    readonly choices?: ReadonlyArray<string> | null;
    /** Варианты составного поля; у остальных видов отсутствуют либо `null`. */
    readonly variants?: ReadonlyArray<ListVariant> | null;
}

/**
 * Способ сравнения в отборе списка. Те же названия принимает действие `list` единого эндпоинта:
 * - `equals`, `notEquals` — значение равно или не равно заданному; с `null` проверяют, заполнено ли поле;
 * - `greater`, `greaterOrEqual`, `less`, `lessOrEqual` — сравнение чисел, сумм и дат;
 * - `contains` — отображаемое значение содержит заданную строкой подстроку без учёта регистра;
 *   `%` и `_` считаются буквальными символами, пробельные разделители разрядов чисел и сумм не учитываются.
 */
export type FilterOperator = 'equals' | 'notEquals' | 'greater' | 'greaterOrEqual' | 'less' | 'lessOrEqual' | 'contains';

const equality: ReadonlyArray<FilterOperator> = ['equals', 'notEquals'];
const ordered: ReadonlyArray<FilterOperator> = ['equals', 'notEquals', 'greater', 'greaterOrEqual', 'less', 'lessOrEqual'];

/**
 * Способы сравнения, допустимые для вида поля. Описание списка предлагает клиенту именно их,
 * а действие `list` отклоняет остальные, поэтому клиент и сервер не расходятся в правилах отбора.
 */
export const filterOperators: { readonly [Kind in FieldKind]: ReadonlyArray<FilterOperator> } = {
    string: ['contains', ...equality],
    number: [...ordered, 'contains'],
    money: [...ordered, 'contains'],
    date: [...ordered, 'contains'],
    dateTime: [...ordered, 'contains'],
    boolean: equality,
    reference: equality,
    objectReference: equality,
    // Упорядоченное сравнение действует внутри простого типа значения; подстрока ищется в показанном тексте варианта.
    composite: [...ordered, 'contains'],
    guid: equality,
    recorder: equality,
};

/** Отбор, который список предлагает по полю, и допустимые для этого поля способы сравнения. */
export interface ListFilter {
    readonly field: string;
    readonly title: string;
    readonly kind: FieldKind;
    readonly target: ObjectTarget | null;
    /** Допустимые строковые значения для выбора. */
    readonly choices?: ReadonlyArray<string> | null;
    /** Варианты составного поля: отбор вводит значение вместе с его типом. */
    readonly variants?: ReadonlyArray<ListVariant> | null;
    /** Способ ввода значения отбора; совпадает со способом ввода поля на форме. */
    readonly inputMode?: InputMode;
    readonly operators: ReadonlyArray<FilterOperator>;
}

/** Направление сортировки в описании списка и в действии `list`. */
export type SortDirection = 'ascending' | 'descending';

/** Сортировка по одному полю. */
export interface ListSort {
    readonly field: string;
    readonly direction: SortDirection;
}

/** Описание списка объекта. */
export interface ListView {
    readonly columns: ReadonlyArray<ListColumn>;
    readonly filters: ReadonlyArray<ListFilter>;
    /** Поля, по которым пользователь может сортировать список. */
    readonly sortable: ReadonlyArray<string>;
    /** Сортировка при открытии списка; поля перечислены по старшинству. */
    readonly defaultSort: ReadonlyArray<ListSort>;
    /**
     * У записей есть пометка удаления (`deletedAt`). Колонкой она не выводится: клиент
     * показывает помеченные записи отдельным признаком строки. У регистров пометки нет.
     */
    readonly deletionMark: boolean;
    /** Имена частей для раскрытия строки списка. */
    readonly tableParts?: ReadonlyArray<string>;
}

/** Описание объекта для клиента: заголовок, форма и список. */
export interface ObjectView {
    /** Полный состав частей для просмотра строк независимо от раскладки формы. */
    readonly tableParts?: ReadonlyArray<FormTablePart>;
    readonly kind: ObjectKind;
    readonly name: string;
    readonly title: string;
    /**
     * Поле-ссылка, по которому строится представление записи, и его цель. `null` означает
     * собственное представление. Целевого объекта может не быть среди описаний: тогда пользователь
     * не вправе его читать, и вместо представления клиент пишет «Нет доступа».
     */
    readonly presentation: DelegatedPresentation | null;
    /** Форма объекта; у регистров `null`. */
    readonly form: FormView | null;
    readonly list: ListView;
    /**
     * Подбор записей: колонки таблицы в окне подбора. Строки клиент получает стандартным действием
     * `lookup`. `null`, если объект подбора не объявил: тогда у поля ссылки нет кнопки подбора.
     */
    readonly lookup: LookupView | null;
}

/** Колонки окна подбора; значение колонки показывается виджетом её вида. */
export interface LookupView {
    readonly columns: ReadonlyArray<FormField>;
}

/**
 * Пункт группы в схеме оболочки: объект конфигурации либо страница. Заголовок объекта клиент берёт
 * из его описания в `objects`, заголовок страницы — из `pages`; иконку он выбирает по виду.
 */
export interface ShellItem {
    /** Вид объекта либо `page` у страницы конфигурации. */
    readonly kind: ObjectKind | 'page';
    readonly name: string;
}

/** Группа подсистемы: заголовок и пункты в порядке показа. Объекты и страницы стоят в общем порядке. */
export interface ShellGroup {
    readonly title: string;
    readonly items: ReadonlyArray<ShellItem>;
}

/** Подсистема оболочки. `name` отличает её от остальных подсистем, пользователю показывается `title`. */
export interface ShellSubsystem {
    readonly name: string;
    readonly title: string;
    readonly groups: ReadonlyArray<ShellGroup>;
}

/**
 * Схема оболочки: подсистемы в порядке показа. Один объект или страница может входить в несколько
 * групп и подсистем, а может не входить ни в одну: тогда они открываются только по адресу,
 * а запись объекта ещё и по ссылке из другой записи.
 */
export interface ShellView {
    readonly subsystems: ReadonlyArray<ShellSubsystem>;
}

/**
 * Страница конфигурации для клиента. Компонента здесь нет: он попадает в клиент при сборке,
 * а сервер сообщает только, какие страницы пользователю доступны и как они называются.
 */
export interface PageView {
    /** Имя страницы: по нему строится адрес `/page/<имя>` и клиент находит компонент. */
    readonly name: string;
    readonly title: string;
}

/**
 * Ответ `GET /api/metadata`: объекты конфигурации, которые пользователь вправе читать, и страницы,
 * которые он вправе открывать, в порядке файлов реестра, а также схема оболочки, в которой
 * оставлены только эти объекты и страницы.
 */
export interface MetadataResponse {
    readonly objects: ReadonlyArray<ObjectView>;
    readonly pages: ReadonlyArray<PageView>;
    readonly shell: ShellView;
}
