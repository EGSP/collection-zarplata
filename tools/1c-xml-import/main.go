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

	"golang.org/x/term"
)

// arguments — параметры запуска. PIN среди них нет: аргументы остаются в истории команд.
type arguments struct {
	xml       string
	mapping   string
	server    string
	batchSize int
}

func parseArguments() arguments {
	var result arguments
	flag.StringVar(&result.xml, "xml", "", "путь к XML-выгрузке 1С")
	flag.StringVar(&result.mapping, "mapping", "", "путь к файлу сопоставления полей")
	flag.StringVar(&result.server, "server", "", "адрес сервера приложения")
	flag.IntVar(&result.batchSize, "batch-size", 100, "размер порции от 1 до 500")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "Импорт справочника из XML 1С")
		fmt.Fprintln(flag.CommandLine.Output(), "Запуск: collection-xml-import --xml <файл> --mapping <файл> --server <адрес> [--batch-size <число>]")
		flag.PrintDefaults()
	}
	flag.Parse()
	if result.xml == "" || result.mapping == "" || result.server == "" || flag.NArg() > 0 {
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
	file, err := os.Open(arguments.xml)
	if err != nil {
		return err
	}
	defer file.Close()

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
	matched, err := readObjects(file, mapping.SourceObject, func(number int, object *element) error {
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
	})
	if err != nil {
		return err
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

func main() {
	if err := run(parseArguments()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
