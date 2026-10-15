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
    ApartmentOutlined,
    AppstoreOutlined,
    BankOutlined,
    BarChartOutlined,
    BookOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    CloseOutlined,
    CreditCardOutlined,
    DeleteOutlined,
    ExportOutlined,
    FileTextOutlined,
    FilterOutlined,
    GlobalOutlined,
    HomeOutlined,
    InboxOutlined,
    LockOutlined,
    LogoutOutlined,
    MoreOutlined,
    PartitionOutlined,
    PlusOutlined,
    ProfileOutlined,
    ReadOutlined,
    RollbackOutlined,
    SaveOutlined,
    SettingOutlined,
    ShopOutlined,
    ShoppingCartOutlined,
    ThunderboltOutlined,
    UnlockOutlined,
    WalletOutlined,
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
    /**
     * Удаление строки табличной части. Крестик, а не корзина: строка убирается из несохранённой
     * формы, и до записи её удаление ничего не стирает.
     */
    removeRow: CloseOutlined,
    /** Отбор списка. */
    filter: FilterOutlined,
    /** Меню остальных действий с элементом. */
    more: MoreOutlined,
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
    /** Запись изменений формы. */
    save: SaveOutlined,
    /** Проведение документа. */
    post: CheckCircleOutlined,

    // Действия продавца: у каждого свой значок, чтобы кнопки рабочего места различались с первого взгляда.
    /** Оформление продажи. */
    sell: ShoppingCartOutlined,
    /** Оформление отвеса: товар откладывается для покупателя. */
    weigh: InboxOutlined,
    /** Оформление возврата. */
    refund: RollbackOutlined,
    /** Оформление рассрочки: оплата взносами по графику. */
    installment: CalendarOutlined,
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
