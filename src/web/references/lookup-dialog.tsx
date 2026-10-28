import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Flex, Input, Modal, Pagination } from 'antd';
import { useState } from 'react';
import type { ObjectView } from '../../server/ui/descriptions';
import { ApiError } from '../common/api';
import { useDebounced } from '../common/debounced';
import { perform, resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay } from '../widgets/registry';
import { BreakpointContainer } from '../sdk/ds/breakpoints';
import { DataTable } from '../sdk/ds/data-table';
import { fieldColumnSize } from '../sdk/platform/column-sizes';

/** Задержка перед запросом после ввода поиска: строки не запрашиваются на каждую букву. */
const searchDelay = 300;

/** Строк на странице окна: окно должно помещаться на экране без прокрутки страницы. */
const pageSize = 20;

/** Ответ действия `lookup`: строки страницы с `guid` записи и общее число найденных строк. */
interface LookupPage {
    readonly total: number;
    readonly rows: ReadonlyArray<RecordData & { readonly guid: string }>;
}

/** Свойства окна подбора. */
export interface LookupDialogProperties {
    /** Объект, записи которого подбираются; у него объявлен подбор. */
    readonly object: ObjectView;
    /** Текущее значение поля: его строка выделена, если попала на страницу. */
    readonly value: string | null;
    readonly onSelect: (guid: string) => void;
    readonly onClose: () => void;
}

/**
 * Окно подбора записи для поля ссылки: строка поиска и таблица с колонками подбора объекта.
 *
 * Строки ищет функция подбора на сервере, окно только передаёт ей строку поиска и страницу.
 * Поэтому, как устроена выборка, клиент не знает: колонки и их значения задаёт конфигурация.
 * Значение колонки показывается виджетом её вида: дата как дата, сумма как деньги.
 *
 * Нажатие на строку выбирает запись и закрывает окно. Новый поиск возвращает на первую страницу:
 * номер прежней страницы для другого набора строк ничего не значит.
 */
export function LookupDialog({ object, value, onSelect, onClose }: LookupDialogProperties) {
    const lookup = object.lookup!;
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const searched = useDebounced(search, searchDelay);
    const { data, isFetching, error } = useQuery({
        queryKey: ['lookup', resourceName(object), searched, page],
        queryFn: () => perform<LookupPage>({ target: { kind: object.kind, name: object.name }, action: 'lookup', payload: { search: searched, page, pageSize } }),
        // Прежние строки остаются на экране до ответа: таблица не мигает пустотой при листании и вводе.
        placeholderData: keepPreviousData,
        staleTime: 0,
    });
    return (
        <Modal open title={`Подбор: ${object.title}`} width={960} footer={null} onCancel={onClose}>
            <BreakpointContainer of="fixed" point="sm">
            <Flex vertical gap="middle">
                <Input.Search
                    autoFocus
                    allowClear
                    placeholder="Поиск"
                    value={search}
                    onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                    }}
                />
                {error !== null && <Alert type="error" showIcon title="Не удалось выполнить подбор" description={error instanceof ApiError ? error.message : String(error)} />}
                <DataTable<LookupPage['rows'][number]>
                    rowKey={(row) => row.guid}
                    loading={isFetching}
                    rows={data?.rows ?? []}
                    columns={lookup.columns.map((column) => ({
                        key: column.name,
                        title: column.title,
                        size: fieldColumnSize(column),
                        align: column.kind === 'money' || column.kind === 'number' ? 'end' : 'start',
                        render: (row: RecordData) => <FieldDisplay field={column} value={row[column.name]} />,
                    }))}
                    // Текущее значение поля отмечено как выбранная строка.
                    selection={{ mode: 'single', isSelected: (row) => row.guid === value, onChange: (row) => { onSelect(row.guid); onClose(); } }}
                    onRowClick={(row) => {
                        onSelect(row.guid);
                        onClose();
                    }}
                    emptyText={isFetching ? 'Загрузка…' : 'Ничего не найдено'}
                />
                <Flex justify="flex-end">
                    <Pagination current={page} pageSize={pageSize} total={data?.total ?? 0} showSizeChanger={false} onChange={setPage} />
                </Flex>
            </Flex>
            </BreakpointContainer>
        </Modal>
    );
}
