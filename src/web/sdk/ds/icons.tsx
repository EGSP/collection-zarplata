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
import type { ComponentProps, ComponentType } from 'react';
import Icon, {
    ApartmentOutlined,
    AppstoreOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    BankOutlined,
    BarChartOutlined,
    BookOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    CloseOutlined,
    CreditCardOutlined,
    DatabaseOutlined,
    DeleteOutlined,
    DownOutlined,
    DownloadOutlined,
    EditOutlined,
    ExclamationCircleFilled,
    ExclamationCircleOutlined,
    ExportOutlined,
    FileTextOutlined,
    FilterOutlined,
    FolderOutlined,
    GlobalOutlined,
    HomeOutlined,
    InboxOutlined,
    InfoCircleFilled,
    LinkOutlined,
    LockOutlined,
    LogoutOutlined,
    MoreOutlined,
    PartitionOutlined,
    PlusOutlined,
    ProfileOutlined,
    ReadOutlined,
    RightOutlined,
    RollbackOutlined,
    SaveOutlined,
    SearchOutlined,
    SettingOutlined,
    SwapOutlined,
    ShopOutlined,
    ShoppingCartOutlined,
    SkinOutlined,
    ThunderboltOutlined,
    UnlockOutlined,
    WalletOutlined,
    WarningFilled,
} from '@ant-design/icons';
import { Pictograms, type PictogramProperties } from './pictograms';

/** Свойства иконки Ant Design: `style`, `title`, `aria-label` и остальные свойства значка. */
type IconProps = Omit<ComponentProps<typeof Icon>, 'component'>;

/**
 * Иконка из собственного рисунка. Обёртка Ant Design `Icon` даёт ей те же свойства и классы,
 * что у значков библиотеки: меню, кнопки и вкладки оформляют её так же, как остальные иконки.
 */
function drawnIcon(Drawing: ComponentType): ComponentType<IconProps> {
    return function DrawnIcon(props: IconProps) {
        return <Icon component={Drawing} {...props} />;
    };
}

/** Утолщение линии пиктограммы на размере иконки, в единицах поля 32×32: 0,72 + 1,2 ≈ 2 единицы, около 1 px на 16 px. */
const pictogramIconEmphasis = 1.2;

/** Иконка из пиктограммы: тот же рисунок с утолщённой линией, чтобы он не бледнел на 16 px. */
function pictogramIcon(Pictogram: ComponentType<PictogramProperties>): ComponentType<IconProps> {
    return drawnIcon(function EmphasizedPictogram() {
        return <Pictogram emphasis={pictogramIconEmphasis} />;
    });
}

/**
 * Значок Switcher из Carbon: девять квадратов сеткой 3×3. Ant Design такого значка не содержит,
 * поэтому рисунок повторён здесь в поле 32×32, как у пиктограмм.
 */
function SwitcherDrawing() {
    const positions = [4, 14, 24];
    return (
        <svg viewBox="0 0 32 32" width="1em" height="1em" fill="currentColor" aria-hidden focusable="false">
            {positions.flatMap((y) => positions.map((x) => <rect key={`${x}.${y}`} x={x} y={y} width={4} height={4} />))}
        </svg>
    );
}

/** Иконки приложения по смыслу. Правила пользования описаны во вводном комментарии модуля. */
export const Icons = {
    /** Создание записи, добавление строки. */
    add: PlusOutlined,
    /** Переход к записи или странице, на которую ссылается элемент. */
    open: ExportOutlined,
    /** Связь с другим документом: строка основания ссылается на продажу. */
    link: LinkOutlined,
    /** Удаление данных: строки табличной части, записи. */
    delete: DeleteOutlined,
    /** Исключение элемента из набора без удаления данных: условия из отбора. */
    remove: CloseOutlined,
    /**
     * Удаление строки табличной части. Крестик, а не корзина: строка убирается из несохранённой
     * формы, и до записи её удаление ничего не стирает.
     */
    removeRow: CloseOutlined,
    /** Отбор списка. */
    filter: FilterOutlined,
    /** Подбор записи для поля ссылки: окно с поиском и таблицей. */
    lookup: SearchOutlined,
    /** Меню остальных действий с элементом. */
    more: MoreOutlined,
    /** Свёрнутая группа строк: нажатие раскроет её. */
    expand: RightOutlined,
    /** Раскрытая группа строк: нажатие свернёт её. */
    collapse: DownOutlined,
    /** Колонка таблицы, по которой можно отсортировать строки; сейчас сортировка по другой колонке. */
    sortable: SwapOutlined,
    /** Выбор даты в календаре. */
    calendar: CalendarOutlined,
    /** Строки таблицы отсортированы по колонке по возрастанию. */
    sortAscending: ArrowUpOutlined,
    /** Строки таблицы отсортированы по колонке по убыванию. */
    sortDescending: ArrowDownOutlined,
    /** Значение ячейки таблицы не прошло проверку; подсказка у значка объясняет причину. */
    invalid: ExclamationCircleOutlined,
    /** Главная вкладка. */
    home: HomeOutlined,
    /** Документация приложения. */
    documentation: ReadOutlined,
    /** Граф модулей сервера. */
    modulesGraph: ApartmentOutlined,
    /** Вид модуля Nest на графе модулей: глобальный, динамический, служебный модуль ядра. */
    globalModule: GlobalOutlined,
    dynamicModule: ThunderboltOutlined,
    coreModule: SettingOutlined,
    /** Выход из приложения. */
    signOut: LogoutOutlined,

    /** Кнопка боковой панели: сворачивает, разворачивает и выдвигает её поверх страницы. */
    switcher: drawnIcon(SwitcherDrawing),

    // Страницы-рабочие места в боковой панели. Имена совпадают со смыслами `PageIcon` описания
    // страницы. Рисунки взяты из пиктограмм плиток главного экрана: пункт панели и плитка одного
    // экрана выглядят одинаково. Линия пиктограммы утолщена до толщины линии иконок (около 1 px на 16 px).
    shop: pictogramIcon(Pictograms.shop),
    salary: pictogramIcon(Pictograms.salary),
    report: pictogramIcon(Pictograms.report),

    // Подсистемы оболочки. Имена совпадают со смыслами `SubsystemIcon` схемы оболочки: боковое меню
    // берёт иконку подсистемы по ним, а значок `subsystem` ставит подсистеме без иконки.
    subsystem: FolderOutlined,
    administration: SettingOutlined,
    trade: ShopOutlined,
    referenceData: DatabaseOutlined,
    /** Запись изменений формы. */
    save: SaveOutlined,
    /** Проведение документа. */
    post: CheckCircleOutlined,
    /** Переход записи в режим изменения, например «Внести изменения» проведённой продажи. */
    edit: EditOutlined,

    // Окно подтверждения действия: значок по оформлению окна (`ActionConfirmationTone`).
    /** Необратимое действие. */
    confirmDanger: ExclamationCircleFilled,
    /** Действие с заметными последствиями. */
    confirmWarning: WarningFilled,
    /** Обычное подтверждение. */
    confirmInfo: InfoCircleFilled,

    // Действия продавца: у каждого свой значок, чтобы кнопки рабочего места различались с первого взгляда.
    /** Оформление продажи. */
    sell: ShoppingCartOutlined,
    /** Оформление отвеса: товар откладывается для покупателя. */
    weigh: InboxOutlined,
    /** Вывешивание товара из отвеса обратно в зал: значок одежды. */
    hang: SkinOutlined,
    /** Оформление возврата. */
    refund: RollbackOutlined,
    /** Оформление рассрочки: оплата взносами по графику. */
    installment: CalendarOutlined,
    /** Приём взноса по рассрочке. */
    acceptPayment: DownloadOutlined,
    /** Подтверждение закрытия погашенной рассрочки. */
    closeInstallment: CheckOutlined,
    // Способы оплаты: переключатель способа показывает значок рядом с названием.
    /** Оплата наличными. */
    cashPayment: WalletOutlined,
    /** Безналичная оплата: картой или переводом. */
    cashlessPayment: CreditCardOutlined,
    /** Часть оплаты, на которую оформляется рассрочка. */
    installmentPayment: CalendarOutlined,
    /** Сложная оплата: несколько оплат разными способами. */
    complexPayment: PartitionOutlined,
    // Типы рассрочки: кто ведёт долг покупателя.
    /** Собственная рассрочка: долг ведёт магазин. */
    ownInstallment: ShopOutlined,
    /** Банковская рассрочка: долг ведёт банк. */
    bankInstallment: BankOutlined,
    /** Открытие смены. */
    openShift: UnlockOutlined,
    /** Закрытие смены. */
    closeShift: LockOutlined,

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
