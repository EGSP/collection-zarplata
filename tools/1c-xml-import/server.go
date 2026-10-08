package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// item — один элемент порции действия import: адрес объекта во внешней системе и значения полей.
type item struct {
	SourceObject       string         `json:"sourceObject"`
	ExternalIdentifier string         `json:"externalIdentifier"`
	Fields             map[string]any `json:"fields"`
}

// server отправляет запросы приложению от имени вошедшего пользователя.
// Доступ хранится в cookie, как у веб-клиента.
type server struct {
	client  *http.Client
	address string
}

// connect проверяет адрес и готовит клиент. PIN уходит на сервер открытым текстом,
// поэтому без HTTPS допускается только локальный адрес.
func connect(address string) (*server, error) {
	address = strings.TrimRight(address, "/")
	parsed, err := url.Parse(address)
	if err != nil {
		return nil, err
	}
	host := parsed.Hostname()
	local := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && local) {
		return nil, errors.New("Для удалённого сервера требуется HTTPS")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Jar:     jar,
		Timeout: 120 * time.Second,
		// Переадресация увела бы PIN и cookie на адрес, который пользователь не указывал.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return &server{client: client, address: address}, nil
}

// post отправляет JSON и возвращает статус и тело ответа целиком.
func (s *server) post(path string, body any) (*http.Response, []byte, error) {
	var content io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		content = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(http.MethodPost, s.address+path, content)
	if err != nil {
		return nil, nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	text, err := io.ReadAll(response.Body)
	return response, text, err
}

func successful(response *http.Response) bool {
	return response.StatusCode >= 200 && response.StatusCode < 300
}

func (s *server) login(pin string) error {
	response, _, err := s.post("/api/authentication/login", map[string]string{"pin": pin})
	if err != nil {
		return err
	}
	if !successful(response) {
		return fmt.Errorf("Вход не выполнен: %s", response.Status)
	}
	return nil
}

// importBatch загружает порцию одной транзакцией сервера и возвращает число созданных
// и обновлённых записей. Доступ обновляется и запрос повторяется только после ответа 401:
// долгий импорт переживает срок действия доступа, а остальные ошибки останавливают его.
func (s *server) importBatch(mapping *mapping, items []item) (created int, updated int, err error) {
	body := map[string]any{
		"target":  map[string]string{"kind": "catalog", "name": mapping.TargetCatalog},
		"action":  "import",
		"payload": map[string]any{"externalSystem": mapping.ExternalSystem, "items": items},
	}
	response, text, err := s.post("/api/perform", body)
	if err != nil {
		return 0, 0, err
	}
	if response.StatusCode == http.StatusUnauthorized {
		refresh, _, err := s.post("/api/authentication/refresh", nil)
		if err != nil {
			return 0, 0, err
		}
		if !successful(refresh) {
			return 0, 0, fmt.Errorf("Доступ не обновлён: %s", refresh.Status)
		}
		if response, text, err = s.post("/api/perform", body); err != nil {
			return 0, 0, err
		}
	}
	if !successful(response) {
		return 0, 0, fmt.Errorf("Импорт остановлен: %s %s", response.Status, text)
	}
	var results []struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(text, &results); err != nil {
		return 0, 0, fmt.Errorf("Сервер вернул неверный ответ: %w", err)
	}
	if len(results) != len(items) {
		return 0, 0, errors.New("Сервер вернул неверное число результатов")
	}
	for _, result := range results {
		switch result.Status {
		case "created":
			created++
		case "updated":
			updated++
		default:
			return 0, 0, errors.New("Сервер вернул неизвестный результат импорта")
		}
	}
	return created, updated, nil
}
