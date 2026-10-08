package main

import (
	"bufio"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
)

// element хранит один элемент XML выбранного объекта 1С. Текстом считается содержимое
// до первого вложенного элемента: у элементов со значением вложенных нет, а у остальных
// там только отступы.
type element struct {
	name     string
	text     string
	hasText  bool
	children []*element
}

// child спускается по пути через «/», на каждом шаге выбирая первый элемент с нужным именем.
func (e *element) child(path string) *element {
	current := e
	for _, name := range strings.Split(path, "/") {
		var next *element
		for _, candidate := range current.children {
			if candidate.name == name {
				next = candidate
				break
			}
		}
		if next == nil {
			return nil
		}
		current = next
	}
	return current
}

// textAt возвращает текст элемента по пути. Второе значение ложно, если элемента нет
// или он пуст: пустой элемент не должен совпасть с пустым whereValue.
func (e *element) textAt(path string) (string, bool) {
	found := e.child(path)
	if found == nil || !found.hasText {
		return "", false
	}
	return found.text, true
}

// readObjects читает выгрузку потоком и передаёт обработчику каждый объект sourceObject
// вместе с его порядковым номером. В памяти находится только один объект, поэтому размер
// файла не ограничен. Возвращает число найденных объектов.
func readObjects(reader io.Reader, sourceObject string, handle func(number int, object *element) error) (int, error) {
	buffered := bufio.NewReaderSize(reader, 1<<20)
	// 1С записывает метку порядка байтов, а разборщик XML считает её текстом до корневого элемента.
	if mark, err := buffered.Peek(3); err == nil && bytes.Equal(mark, []byte{0xEF, 0xBB, 0xBF}) {
		_, _ = buffered.Discard(3)
	}
	decoder := xml.NewDecoder(buffered)
	// Открытые элементы выбранного объекта; пуст, пока чтение находится вне объекта.
	var open []*element
	matched := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return matched, nil
		}
		if err != nil {
			var syntax *xml.SyntaxError
			if len(open) > 0 && errors.As(err, &syntax) && syntax.Msg == "unexpected EOF" {
				return matched, errors.New("XML оборван внутри объекта")
			}
			return matched, fmt.Errorf("Ошибка чтения XML: %w", err)
		}
		switch token := token.(type) {
		case xml.StartElement:
			if len(open) == 0 {
				if token.Name.Local == sourceObject {
					open = append(open, &element{name: token.Name.Local})
				}
				continue
			}
			parent := open[len(open)-1]
			child := &element{name: token.Name.Local}
			parent.children = append(parent.children, child)
			open = append(open, child)
		case xml.CharData:
			if len(open) > 0 {
				current := open[len(open)-1]
				if len(current.children) == 0 {
					current.text += string(token)
					current.hasText = true
				}
			}
		case xml.EndElement:
			if len(open) == 0 {
				continue
			}
			finished := open[len(open)-1]
			open = open[:len(open)-1]
			if len(open) == 0 {
				matched++
				if err := handle(matched, finished); err != nil {
					return matched, err
				}
			}
		}
	}
}
