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
import type { FieldKind, FieldRole, ObjectKind, ObjectTarget, RecorderValue } from '../metadata/descriptions.js';

export type { FieldKind, ObjectKind, ObjectTarget, RecorderValue };

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
    /** Значение заполняет платформа: поле показывается, но не редактируется и не входит в порядок обхода. */
    readonly readOnly: boolean;
    readonly rules: ValidationRules;
}

/** Табличная часть формы: колонки — поля одной строки в порядке объявления. */
export interface FormTablePart {
    readonly name: string;
    readonly title: string;
    readonly columns: ReadonlyArray<FormField>;
}

/**
 * Группа элементов формы. `elements` — имена полей и табличных частей в порядке показа;
 * их описания лежат в `fields` и `tableParts` формы. Группа без заголовка (`title: null`)
 * показывается без рамки: в неё попадают элементы, которые конфигурация не распределила по группам.
 */
export interface FormGroup {
    readonly title: string | null;
    readonly elements: ReadonlyArray<string>;
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
}

/**
 * Описание формы объекта. Форма есть у справочников и документов; строки регистров записывают
 * только документы при проведении, поэтому формы регистра нет.
 */
export interface FormView {
    /** Поля, которые выводятся на форму, в порядке объявления. Скрытых полей здесь нет. */
    readonly fields: ReadonlyArray<FormField>;
    /** Табличные части, которые выводятся на форму, в порядке объявления. */
    readonly tableParts: ReadonlyArray<FormTablePart>;
    /** Раскладка формы: каждое поле и каждая табличная часть входят ровно в одну группу. */
    readonly groups: ReadonlyArray<FormGroup>;
    /**
     * Порядок обхода с клавиатуры: имена редактируемых полей и табличных частей. Следует
     * за раскладкой групп; поля только для чтения пропускаются. Табличная часть — одна
     * остановка, внутри неё клиент обходит ячейки сам.
     */
    readonly traversal: ReadonlyArray<string>;
    /**
     * Действия формы в порядке показа. В ответе сервера остаются только действия, на которые
     * у пользователя есть право; форму без действия `save` клиент показывает только для просмотра.
     */
    readonly actions: ReadonlyArray<FormAction>;
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
}

/** Описание объекта для клиента: заголовок, форма и список. */
export interface ObjectView {
    readonly kind: ObjectKind;
    readonly name: string;
    readonly title: string;
    /** Форма объекта; у регистров `null`. */
    readonly form: FormView | null;
    readonly list: ListView;
}

/** Ссылка на объект конфигурации в схеме оболочки. Заголовок и вид для иконки клиент берёт из описания объекта. */
export interface ShellObject {
    readonly kind: ObjectKind;
    readonly name: string;
}

/** Группа подсистемы: заголовок и объекты в порядке показа. */
export interface ShellGroup {
    readonly title: string;
    readonly objects: ReadonlyArray<ShellObject>;
}

/** Подсистема оболочки. `name` отличает её от остальных подсистем, пользователю показывается `title`. */
export interface ShellSubsystem {
    readonly name: string;
    readonly title: string;
    readonly groups: ReadonlyArray<ShellGroup>;
}

/**
 * Схема оболочки: подсистемы в порядке показа. Один объект может входить в несколько групп
 * и подсистем, а объект из `objects` ответа может не входить ни в одну: тогда он открывается
 * только по адресу и по ссылке из другой записи.
 */
export interface ShellView {
    readonly subsystems: ReadonlyArray<ShellSubsystem>;
}

/**
 * Ответ `GET /api/metadata`: объекты конфигурации, которые пользователь вправе читать, в порядке
 * файлов реестра, и схема оболочки, в которой оставлены только эти объекты.
 */
export interface MetadataResponse {
    readonly objects: ReadonlyArray<ObjectView>;
    readonly shell: ShellView;
}
