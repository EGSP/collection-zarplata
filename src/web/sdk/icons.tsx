/**
 * Реестр иконок по смыслу: какой значок в приложении обозначает добавление, открытие, удаление
 * и прочие повторяющиеся действия, состояния и виды объектов.
 *
 * Экран выбирает иконку по смыслу действия, а не по рисунку: `<Icons.open />`, а не конкретный
 * значок библиотеки. Поэтому одно действие выглядит одинаково на всех экранах, а заменить рисунок
 * можно в одном месте. Пакет `@ant-design/icons` импортирует только этот модуль.
 *
 * Запись реестра — компонент иконки Ant Design, он принимает её обычные свойства: `style`, `title`,
 * `aria-label`. Иконке без подписи рядом нужно название для чтения с экрана: `aria-label` у неё
 * самой или у кнопки, на которой она стоит.
 *
 * Если подходящего смысла в реестре нет, в него добавляют новую запись, а не импортируют значок
 * на месте. Два смысла могут делить один рисунок: записи остаются разными, чтобы рисунок одного
 * можно было заменить, не затронув другой.
 */
import {
    AppstoreOutlined,
    BarChartOutlined,
    BookOutlined,
    CheckCircleOutlined,
    CloseOutlined,
    DeleteOutlined,
    ExportOutlined,
    FileTextOutlined,
    FilterOutlined,
    HomeOutlined,
    LogoutOutlined,
    MoreOutlined,
    PlusOutlined,
    ProfileOutlined,
    ReadOutlined,
} from '@ant-design/icons';

/** Иконки приложения по смыслу. Правила пользования описаны во вводном комментарии модуля. */
export const Icons = {
    /** Создание записи, добавление строки. */
    add: PlusOutlined,
    /** Переход к записи или странице, на которую ссылается элемент. */
    open: ExportOutlined,
    /** Удаление данных: строки табличной части, записи. */
    delete: DeleteOutlined,
    /** Исключение элемента из набора без удаления данных: условия из отбора. */
    remove: CloseOutlined,
    /** Отбор списка. */
    filter: FilterOutlined,
    /** Меню остальных действий с элементом. */
    more: MoreOutlined,
    /** Главная вкладка. */
    home: HomeOutlined,
    /** Документация приложения. */
    documentation: ReadOutlined,
    /** Выход из приложения. */
    signOut: LogoutOutlined,

    /** Состояние записи: помечена на удаление. */
    markedDeleted: DeleteOutlined,
    /** Состояние документа: проведён. */
    posted: CheckCircleOutlined,

    // Виды объектов и страница конфигурации. Имена совпадают с видами пунктов схемы оболочки:
    // меню подсистем берёт иконку пункта по его виду.
    catalog: BookOutlined,
    document: FileTextOutlined,
    register: BarChartOutlined,
    informationRegister: ProfileOutlined,
    page: AppstoreOutlined,
};

/** Имя иконки в реестре: смысл, который она обозначает. */
export type IconName = keyof typeof Icons;
