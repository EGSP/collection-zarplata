import { Alert, Button } from 'antd';
import { Icons, ListControlsProvider, ListFilters, ListSearch, Page, RecordTable, ShellGroupContent, ShellGroups, useListControlsState, useOpenRecord, useRecordList, type ObjectView } from '../sdk';

/**
 * Список объекта конфигурации: поиск, отбор и таблица записей по описанию списка. Собран
 * из web SDK и служит образцом собственного экрана со списком.
 *
 * Сортировку, отбор, поиск и номер страницы список хранит в адресе вкладки: адрес с отбором можно
 * сохранить в закладки. Пока вкладка списка открыта, список остаётся смонтированным и своё
 * состояние не теряет.
 *
 * Кнопка «Создать» есть, если в описании формы есть действие `save` и компонент группы
 * списка не скрыл её через SDK. Режим она не указывает:
 * форма открывается во вкладке или в окне поверх списка, как задано в конфигурации объекта.
 * Запись, созданную в окне, список показывает сам: действие записи помечает его данные устаревшими.
 * У обоих видов регистров формы нет: их списки доступны только для просмотра.
 */
export function ObjectList({ object }: { readonly object: ObjectView }) {
    return <ListControlsProvider><ControlledObjectList object={object} /></ListControlsProvider>;
}

/** Содержимое списка в собственной области управления действиями. */
function ControlledObjectList({ object }: { readonly object: ObjectView }) {
    const controls = useListControlsState();
    const openRecord = useOpenRecord();
    const list = useRecordList(object, { sort: object.list.defaultSort, address: true });
    const creatable = controls?.hideCreate !== true && object.form?.actions.some((action) => action.name === 'save') === true;
    return (
        <Page
            title={object.title}
            actions={
                creatable ? (
                    <Button type="primary" icon={<Icons.add />} onClick={() => void openRecord(object, null)}>
                        Создать
                    </Button>
                ) : undefined
            }
        >
            <ShellGroupContent group={ShellGroups.list(object)} />
            <ListSearch value={list.search} onSearch={list.setSearch} />
            <ListFilters filters={object.list.filters} applied={list.filter} onApply={list.setFilter} />
            {list.error !== null && <Alert type="error" showIcon title="Не удалось загрузить список" description={list.error.message} />}
            <RecordTable object={object} list={list} hiddenRowActions={controls?.hiddenRowActions} />
        </Page>
    );
}
