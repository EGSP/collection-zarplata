import { Alert, Button } from 'antd';
import { useNavigate } from 'react-router';
import { Icons, ListFilters, ListSearch, newRecordPath, Page, RecordTable, useRecordList, type ObjectView } from '../sdk';

/**
 * Список объекта конфигурации: поиск, отбор и таблица записей по описанию списка. Собран
 * из web SDK и служит образцом собственного экрана со списком.
 *
 * Сортировку, отбор, поиск и номер страницы список хранит в адресе вкладки: адрес с отбором можно
 * сохранить в закладки. Пока вкладка списка открыта, список остаётся смонтированным и своё
 * состояние не теряет.
 *
 * Кнопка «Создать» есть, если в описании формы есть действие `save`. У обоих видов регистров
 * формы нет: их списки доступны только для просмотра.
 */
export function ObjectList({ object }: { readonly object: ObjectView }) {
    const navigate = useNavigate();
    const list = useRecordList(object, { sort: object.list.defaultSort, address: true });
    const creatable = object.form?.actions.some((action) => action.name === 'save') === true;
    return (
        <Page
            title={object.title}
            actions={
                creatable ? (
                    <Button type="primary" icon={<Icons.add />} onClick={() => void navigate(newRecordPath(object))}>
                        Создать
                    </Button>
                ) : undefined
            }
        >
            <ListSearch value={list.search} onSearch={list.setSearch} />
            <ListFilters filters={object.list.filters} applied={list.filter} onApply={list.setFilter} />
            {list.error !== null && <Alert type="error" showIcon title="Не удалось загрузить список" description={list.error.message} />}
            <RecordTable object={object} list={list} />
        </Page>
    );
}
