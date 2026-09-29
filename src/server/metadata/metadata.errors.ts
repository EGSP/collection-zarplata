import { Data } from 'effect';

/** Проблема в описании объекта конфигурации. */
export interface MetadataProblem {
    /** Объект, например `catalog employees`. */
    readonly object: string;
    /** Место в описании, например `поле position`; пусто, если проблема относится ко всему объекту. */
    readonly location: string | null;
    readonly message: string;
}

/** Описание объектов конфигурации содержит ошибки. Перечисляет все найденные проблемы. */
export class MetadataError extends Data.TaggedError('MetadataError')<{
    readonly problems: ReadonlyArray<MetadataProblem>;
}> {
    override get message(): string {
        const lines = this.problems.map((problem) =>
            problem.location === null
                ? `- ${problem.object}: ${problem.message}`
                : `- ${problem.object}, ${problem.location}: ${problem.message}`,
        );
        return ['Ошибки в описании объектов конфигурации:', ...lines].join('\n');
    }
}
