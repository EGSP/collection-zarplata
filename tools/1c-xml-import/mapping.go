package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"unicode/utf8"
)

// mapping описывает, какой объект выгрузки 1С в какой справочник приложения загружается.
// Пути в правилах полей относительны корню одного объекта 1С.
type mapping struct {
	Schema         *string          `json:"$schema"`
	SourceObject   string           `json:"sourceObject"`
	TargetCatalog  string           `json:"targetCatalog"`
	ExternalSystem string           `json:"externalSystem"`
	Fields         map[string]field `json:"fields"`
}

// field задаёт значение одного поля приложения: константу либо текст элемента XML,
// при необходимости взятый из выбранной строки табличной части и преобразованный.
type field struct {
	Path       *string                    `json:"path"`
	RowPath    *string                    `json:"rowPath"`
	WhereField *string                    `json:"whereField"`
	WhereValue *string                    `json:"whereValue"`
	Constant   *json.RawMessage           `json:"constant"`
	DateOnly   bool                       `json:"dateOnly"`
	Values     map[string]json.RawMessage `json:"values"`
}

// readMapping читает и проверяет файл сопоставления. Ошибка возвращается до обращения
// к серверу, чтобы неверный файл не привёл к частичной загрузке.
func readMapping(path string) (*mapping, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	// Без этого опечатка в имени свойства была бы пропущена молча, и поле загрузилось бы
	// без задуманного правила.
	decoder.DisallowUnknownFields()
	result := &mapping{}
	if err := decoder.Decode(result); err != nil {
		return nil, fmt.Errorf("Неверный файл сопоставления: %w", err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errors.New("Неверный файл сопоставления: после описания есть лишние данные")
	}
	if len(result.Fields) == 0 ||
		strings.TrimSpace(result.ExternalSystem) == "" ||
		strings.TrimSpace(result.TargetCatalog) == "" ||
		!strings.HasPrefix(result.SourceObject, "CatalogObject.") {
		return nil, errors.New("Неверное описание сопоставления")
	}
	for _, name := range result.fieldNames() {
		if err := result.Fields[name].validate(); err != nil {
			return nil, fmt.Errorf("Поле %s: %w", name, err)
		}
	}
	return result, nil
}

// fieldNames возвращает имена полей по алфавиту: порядок обхода map в Go случаен,
// а сообщение об ошибке должно называть одно и то же поле при каждом запуске.
func (m *mapping) fieldNames() []string {
	names := make([]string, 0, len(m.Fields))
	for name := range m.Fields {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (f field) validate() error {
	if (f.Path != nil) == (f.Constant != nil) {
		return errors.New("задайте ровно одно из path и constant")
	}
	if f.Path != nil && !validPath(*f.Path) {
		return errors.New("неверный путь")
	}
	if (f.RowPath != nil) != (f.WhereField != nil) || (f.RowPath != nil) != (f.WhereValue != nil) {
		return errors.New("rowPath, whereField и whereValue задаются вместе")
	}
	if f.RowPath != nil && !strings.Contains(*f.RowPath, "/") {
		return errors.New("rowPath должен включать таблицу и строку")
	}
	if f.Constant != nil && (f.DateOnly || f.Values != nil || f.RowPath != nil) {
		return errors.New("преобразование константы не поддерживается")
	}
	return nil
}

func validPath(path string) bool {
	for _, part := range strings.Split(path, "/") {
		if part == "" {
			return false
		}
	}
	return true
}

// value вычисляет значение поля для одного объекта 1С. Пустой или отсутствующий элемент
// даёт nil, то есть null в запросе к серверу.
func (f field) value(object *element) (any, error) {
	if f.Constant != nil {
		return *f.Constant, nil
	}
	source := object
	if f.RowPath != nil {
		source = f.row(object)
	}
	text := ""
	if source != nil {
		text, _ = source.textAt(*f.Path)
	}
	text = strings.TrimSpace(text)
	// Незаполненную дату 1С выгружает как 0001-01-01, а не пустым элементом.
	if text == "" || (f.DateOnly && strings.HasPrefix(text, "0001-01-01")) {
		return nil, nil
	}
	if f.Values != nil {
		mapped, found := f.Values[text]
		if !found {
			return nil, fmt.Errorf("Нет сопоставления значения «%s»", text)
		}
		return mapped, nil
	}
	if f.DateOnly {
		// Срез по байтам посреди многобайтового символа дал бы испорченную строку.
		if len(text) < 10 || (len(text) > 10 && !utf8.RuneStart(text[10])) {
			return nil, errors.New("Неверная дата")
		}
		return text[:10], nil
	}
	return text, nil
}

// row находит первую строку табличной части, у которой поле whereField равно whereValue.
func (f field) row(object *element) *element {
	separator := strings.LastIndex(*f.RowPath, "/")
	table := object.child((*f.RowPath)[:separator])
	if table == nil {
		return nil
	}
	rowName := (*f.RowPath)[separator+1:]
	for _, row := range table.children {
		if row.name != rowName {
			continue
		}
		if text, found := row.textAt(*f.WhereField); found && text == *f.WhereValue {
			return row
		}
	}
	return nil
}
