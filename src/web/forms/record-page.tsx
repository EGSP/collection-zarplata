import { Button, Result } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { NotFoundPage } from '../common/not-found';
import { newRecordSegment } from '../common/paths';
import { objectPath, useObjectView } from '../sdk';
import { draftValues } from '../sdk/platform/open-record';
import { ExistingRecordForm } from './existing-record-form';
import { ObjectRecordForm } from './object-forms';
import { Pending } from '../common/pending';
import { resolveRecordOpening } from '../data-provider/record-opening';
import type { ObjectReferenceValue } from '../../server/metadata/descriptions';
import type { ObjectView } from '../../server/ui/descriptions';

/**
 * Страница вкладки с формой записи: `/вид/имя/new` открывает форму новой записи, `/вид/имя/<guid>`
 * открывает форму существующей, `/вид/имя/new/<ключ>` открывает форму новой записи со значениями
 * черновика, которые передал открывший её код. У записи есть собственный адрес, потому что на неё ведут ссылки
 * из списков, из строк регистров и из других форм.
 *
 * Страница разбирает адрес и разрешает цель существующей записи на сервере до открытия формы.
 * Сама форма и чтение её данных не зависят от адреса исходной ссылки.
 *
 * У регистра формы нет, поэтому его адреса форм показывают страницу «не найдено». Так же
 * отвечает адрес новой записи, если у пользователя нет права записи.
 */
export function RecordPage() {
    const { kind, name, guid, draft } = useParams();
    const [parameters] = useSearchParams();
    const object = useObjectView(kind === undefined || name === undefined ? null : { kind, name });
    if (object === undefined || object.form === null || guid === undefined) return <NotFoundPage />;
    // После записи новой формы вкладка получает адрес существующей записи. Ключ пересоздаёт форму:
    // существующую запись она читает с сервера, а действия над ней перечитывают её тем же запросом.
    const key = `${objectPath(object)}/${guid}`;
    if (draft !== undefined && guid !== newRecordSegment) return <NotFoundPage />;
    if (guid !== newRecordSegment) {
        const original = parameters.get('original') === '1';
        return <ResolvedRecordPage key={`${key}/${original}`} object={object} guid={guid} original={original} />;
    }
    if (!object.form.actions.some((action) => action.name === 'save')) return <NotFoundPage />;
    // Ключ черновика различает формы: у каждого черновика своя вкладка и свои значения.
    return <ObjectRecordForm key={draft === undefined ? key : `${key}/${draft}`} object={object} view={object.form} record={null} reload={null} presentation="page" initial={draft === undefined ? undefined : draftValues(draft)} />;
}

/**
 * Прямой адрес проходит тот же серверный этап, что ссылка и SDK, до монтирования формы.
 * Адрес исходной ссылки остаётся пригодным для повторного открытия. Запрос выполняется один
 * раз при открытии: фоновое обновление не должно заменять форму с несохранённым вводом.
 */
function ResolvedRecordPage({ object, guid, original }: { readonly object: ObjectView; readonly guid: string; readonly original: boolean }) {
    const [result, setResult] = useState<ObjectReferenceValue | Error | null>(null);
    const kind = object.kind;
    const name = object.name;
    useEffect(() => {
        let active = true;
        void resolveRecordOpening({ kind, name }, guid, original).then(
            (reference) => { if (active) setResult(reference); },
            (error: unknown) => { if (active) setResult(error instanceof Error ? error : new Error('Не удалось открыть запись')); },
        );
        return () => { active = false; };
    }, [kind, name, guid, original]);
    const resolved = useObjectView(result === null || result instanceof Error ? null : result);
    const failureAction = <Link to={objectPath(object)}><Button type="primary">Вернуться в список</Button></Link>;
    if (result === null) return <Pending />;
    if (result instanceof Error) return <Result status="warning" title="Не удалось открыть запись" subTitle={result.message} extra={failureAction} />;
    if (resolved === undefined || resolved.form === null) return <NotFoundPage />;
    return <ExistingRecordForm object={resolved} view={resolved.form} guid={result.guid} presentation="page" failureAction={failureAction} />;
}
