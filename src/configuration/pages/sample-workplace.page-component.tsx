import { Alert } from 'antd';
import { useState } from 'react';
import { ActionButton, Page, RecordTable, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Пробное рабочее место: непроведённые пробные документы и кнопка «Провести» для выбранного.
 * Служит образцом страницы конфигурации: экран собран из web SDK, а объект указан ссылкой
 * `Objects.document.sample`, по которой компилятор проверяет имена колонок, поля отбора и действия.
 *
 * Проведённый документ под отбор не подходит. После проведения SDK перечитывает списки,
 * и документ исчезает из таблицы без отдельного кода на странице.
 */
export default function SampleWorkplacePage() {
    const documents = Objects.document.sample;
    const list = useRecordList(documents, {
        permanentFilter: [{ field: 'posted', operator: 'equals', value: false }],
        sort: [
            { field: 'date', direction: 'descending' },
            { field: 'number', direction: 'descending' },
        ],
    });
    // Хранится `guid`, а не запись: после перечитывания списка выбранной остаётся строка с тем же
    // `guid`, а проведённый документ из списка уходит, и выбор снимается сам.
    const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
    const selected = list.records.find((record) => record.guid === selectedGuid) ?? null;
    return (
        <Page title="Пробное рабочее место" actions={<ActionButton type="primary" object={documents} record={selected} action="post" />}>
            {list.error !== null && <Alert type="error" showIcon title="Не удалось загрузить документы" description={list.error.message} />}
            <RecordTable object={documents} list={list} columns={['number', 'date', 'item']} selected={selected} onSelect={(record) => setSelectedGuid(record.guid)} />
        </Page>
    );
}
