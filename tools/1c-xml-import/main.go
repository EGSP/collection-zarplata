// Импорт справочника из универсальной XML-выгрузки 1С через единый API приложения.
//
// Выгрузка читается потоком: в памяти находятся один выбранный объект и порция до 500 записей.
// Есть ли запись уже в приложении, решает сервер по внешним связям, поэтому повторный запуск
// с тем же файлом обновляет записи и не создаёт дубликатов.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/term"
)

// arguments — параметры запуска. PIN среди них нет: аргументы остаются в истории команд.
type arguments struct {
	xml       string
	mapping   string
	server    string
	batchSize int
	// localSource заменяет --xml: выгрузки ищутся в каталоге local-source рядом с исполняемым файлом.
	localSource bool
}

// localSourceDirectory — каталог выгрузок рядом с утилитой. Git его не отслеживает: выгрузки
// содержат персональные данные.
const localSourceDirectory = "local-source"

func parseArguments() arguments {
	var result arguments
	flag.StringVar(&result.xml, "xml", "", "путь к XML-выгрузке 1С")
	flag.StringVar(&result.mapping, "mapping", "", "путь к файлу сопоставления полей")
	flag.StringVar(&result.server, "server", "", "адрес сервера приложения")
	flag.IntVar(&result.batchSize, "batch-size", 100, "размер порции от 1 до 500")
	flag.BoolVar(&result.localSource, "local-source", false, "искать выгрузки в каталоге local-source рядом с утилитой вместо --xml")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "Импорт справочника из XML 1С")
		fmt.Fprintln(flag.CommandLine.Output(), "Запуск: collection-xml-import (--xml <файл> | --local-source) --mapping <файл> --server <адрес> [--batch-size <число>]")
		flag.PrintDefaults()
	}
	flag.Parse()
	// Источник задаётся ровно одним способом: при обоих неясно, какие выгрузки читать.
	singleSource := (result.xml != "") != result.localSource
	if !singleSource || result.mapping == "" || result.server == "" || flag.NArg() > 0 {
		flag.Usage()
		os.Exit(2)
	}
	return result
}

// readPin берёт PIN из окружения для автоматизированного запуска, иначе спрашивает
// его без отображения на экране.
func readPin() (string, error) {
	if pin, found := os.LookupEnv("COLLECTION_IMPORT_PIN"); found {
		return pin, nil
	}
	fmt.Fprint(os.Stderr, "PIN: ")
	pin, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", fmt.Errorf("Не удалось прочитать PIN: %w", err)
	}
	return string(pin), nil
}

func run(arguments arguments) error {
	if arguments.batchSize < 1 || arguments.batchSize > 500 {
		return errors.New("Размер порции должен быть от 1 до 500")
	}
	mapping, err := readMapping(arguments.mapping)
	if err != nil {
		return err
	}
	// Выгрузки выбираются до входа на сервер: без данных PIN запрашивать незачем.
	sources, err := sourceFiles(arguments, mapping.SourceObject)
	if err != nil {
		return err
	}
	server, err := connect(arguments.server)
	if err != nil {
		return err
	}
	pin, err := readPin()
	if err != nil {
		return err
	}
	if err := server.login(pin); err != nil {
		return err
	}

	fieldNames := mapping.fieldNames()
	items := make([]item, 0, arguments.batchSize)
	created, updated := 0, 0
	send := func() error {
		batchCreated, batchUpdated, err := server.importBatch(mapping, items)
		created += batchCreated
		updated += batchUpdated
		items = items[:0]
		return err
	}
	collect := func(number int, object *element) error {
		// Группы справочника 1С не являются записями и в приложение не переносятся.
		if folder, _ := object.textAt("IsFolder"); folder == "true" {
			return nil
		}
		identifier, found := object.textAt("Ref")
		if !found {
			return errors.New("Объект без Ref")
		}
		fields := make(map[string]any, len(fieldNames))
		for _, name := range fieldNames {
			value, err := mapping.Fields[name].value(object)
			if err != nil {
				return fmt.Errorf("Элемент %d, поле %s: %w", number, name, err)
			}
			fields[name] = value
		}
		items = append(items, item{SourceObject: mapping.SourceObject, ExternalIdentifier: identifier, Fields: fields})
		if len(items) == arguments.batchSize {
			return send()
		}
		return nil
	}
	// Объекты одного вида могут оказаться в нескольких выгрузках; порции продолжаются через границу файлов.
	matched := 0
	for _, source := range sources {
		count, err := readFile(source, mapping.SourceObject, collect)
		if err != nil {
			return fmt.Errorf("%s: %w", filepath.Base(source), err)
		}
		matched += count
	}
	if len(items) > 0 {
		if err := send(); err != nil {
			return err
		}
	}
	if matched == 0 {
		return fmt.Errorf("В XML нет объектов %s", mapping.SourceObject)
	}
	fmt.Printf("Создано: %d, обновлено: %d\n", created, updated)
	return nil
}

// sourceFiles возвращает выгрузки для чтения. Файл из --xml читается как есть. С --local-source
// утилита сама отбирает в каталоге выгрузок файлы, где встречается вид объекта сопоставления:
// какая выгрузка какие объекты содержит, извне не сообщается.
func sourceFiles(arguments arguments, sourceObject string) ([]string, error) {
	if !arguments.localSource {
		return []string{arguments.xml}, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("Не удалось определить каталог утилиты: %w", err)
	}
	directory := filepath.Join(filepath.Dir(executable), localSourceDirectory)
	// Glob сортирует имена, поэтому выгрузки читаются в одном порядке при каждом запуске.
	candidates, err := filepath.Glob(filepath.Join(directory, "*.xml"))
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("В каталоге %s нет XML-выгрузок", directory)
	}
	var found []string
	for _, candidate := range candidates {
		contains, err := containsObject(candidate, sourceObject)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Base(candidate), err)
		}
		if contains {
			found = append(found, candidate)
		}
	}
	if len(found) == 0 {
		return nil, fmt.Errorf("В выгрузках каталога %s нет объектов %s", directory, sourceObject)
	}
	return found, nil
}

// readFile открывает выгрузку и передаёт обработчику её объекты sourceObject.
func readFile(path string, sourceObject string, handle func(number int, object *element) error) (int, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	return readObjects(file, sourceObject, handle)
}

func main() {
	if err := run(parseArguments()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
