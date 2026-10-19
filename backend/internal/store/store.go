package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"
)

type Meta struct {
	ID        string    `json:"id"`
	OrigName  string    `json:"origName"`
	CreatedAt time.Time `json:"createdAt"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Mime      string    `json:"mime"`
}

// Store persists strips. JSON documents go through Load/Save so they can move
// to sqlite; image blobs stay on disk and are addressed by Path.
type Store interface {
	Has(id string) bool
	Meta(id string) (Meta, error)
	SaveMeta(m Meta) error
	Recent(limit int) ([]Meta, error)

	LoadStage(id, stage string, ver int, v any) (bool, error)
	SaveStage(id, stage string, ver int, v any) error

	LoadTranslation(id, lang string, ver int, v any) (bool, error)
	SaveTranslation(id, lang string, ver int, v any) error
	LoadEdit(id, lang string, v any) (bool, error)
	SaveEdit(id, lang string, v any) error
	Langs(id string) []string

	Path(id string, rel ...string) string
	Root() string
	WriteFile(id, rel string, data []byte) error
}

type FS struct{ root string }

func NewFS(root string) (*FS, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	return &FS{root: abs}, nil
}

func (s *FS) Root() string { return s.root }

func (s *FS) Path(id string, rel ...string) string {
	return filepath.Join(append([]string{s.root, id}, rel...)...)
}

func (s *FS) Has(id string) bool {
	_, err := os.Stat(s.Path(id, "meta.json"))
	return err == nil
}

func (s *FS) Meta(id string) (Meta, error) {
	var m Meta
	ok, err := s.load(s.Path(id, "meta.json"), &m)
	if err == nil && !ok {
		err = fs.ErrNotExist
	}
	return m, err
}

func (s *FS) SaveMeta(m Meta) error { return s.save(s.Path(m.ID, "meta.json"), m) }

func (s *FS) Recent(limit int) ([]Meta, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	var metas []Meta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if m, err := s.Meta(e.Name()); err == nil {
			metas = append(metas, m)
		}
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].CreatedAt.After(metas[j].CreatedAt) })
	if limit > 0 && len(metas) > limit {
		metas = metas[:limit]
	}
	return metas, nil
}

func stageFile(stage string, ver int) string { return fmt.Sprintf("%s@v%d.json", stage, ver) }

func (s *FS) LoadStage(id, stage string, ver int, v any) (bool, error) {
	return s.load(s.Path(id, "stages", stageFile(stage, ver)), v)
}

func (s *FS) SaveStage(id, stage string, ver int, v any) error {
	return s.save(s.Path(id, "stages", stageFile(stage, ver)), v)
}

func (s *FS) LoadTranslation(id, lang string, ver int, v any) (bool, error) {
	return s.load(s.Path(id, "tr", stageFile(lang, ver)), v)
}

func (s *FS) SaveTranslation(id, lang string, ver int, v any) error {
	return s.save(s.Path(id, "tr", stageFile(lang, ver)), v)
}

func (s *FS) LoadEdit(id, lang string, v any) (bool, error) {
	return s.load(s.Path(id, "tr", lang+".edit.json"), v)
}

func (s *FS) SaveEdit(id, lang string, v any) error {
	return s.save(s.Path(id, "tr", lang+".edit.json"), v)
}

func (s *FS) Langs(id string) []string {
	entries, _ := os.ReadDir(s.Path(id, "tr"))
	seen := map[string]bool{}
	langs := []string{}
	for _, e := range entries {
		name := e.Name()
		lang, _, ok := strings.Cut(name, "@")
		if !ok {
			lang, _, ok = strings.Cut(name, ".edit.json")
		}
		if ok && !seen[lang] {
			seen[lang] = true
			langs = append(langs, lang)
		}
	}
	sort.Strings(langs)
	return langs
}

func (s *FS) WriteFile(id, rel string, data []byte) error {
	return writeAtomic(s.Path(id, rel), data)
}

func (s *FS) load(path string, v any) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	target := reflect.ValueOf(v).Elem()
	target.Set(reflect.Zero(target.Type()))
	return true, json.Unmarshal(data, v)
}

func (s *FS) save(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, data)
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
