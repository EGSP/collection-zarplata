import { document, formula } from '../../server/metadata/index.js';
import { SampleLines } from '../sample-lines.js';
import { SampleDocument } from './sample.document.js';

/** Второй потребитель общей части: раскрытие документа по ссылке и копирование выбранной строки. */
export const SampleSelection = document('sampleSelection')
    .title('Пробный выбор строк')
    .field('source', (field) => field.reference(SampleDocument).title('Документ-источник'))
    .field('total', (field) => field.money().title('Итого').required().computed(formula.sum('lines', 'netAmount')))
    .tablePart('lines', (part) => part.title('Выбранные строки').include(SampleLines).field('note', (field) => field.string().title('Примечание')))
    .tablePart('documents', (part) => part.title('Документы').field('document', (field) => field.reference(SampleDocument).title('Документ').expandTablePart('lines')))
    .form((form) => form.group('Основное', ['number', 'date', 'source', 'total']).group('Строки', ['lines', 'documents']))
    .listTableParts(['lines']);
