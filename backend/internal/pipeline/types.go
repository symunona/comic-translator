package pipeline

import (
	"image"

	"comic-translator/backend/internal/store"
)

type Box [4]int

func BoxOf(r image.Rectangle) Box { return Box{r.Min.X, r.Min.Y, r.Dx(), r.Dy()} }

func (b Box) Rect() image.Rectangle { return image.Rect(b[0], b[1], b[0]+b[2], b[1]+b[3]) }

type Panel struct {
	ID    string `json:"id"`
	Order int    `json:"order"`
	BBox  Box    `json:"bbox"`
}

type Source struct {
	Text  string   `json:"text"`
	Lines []string `json:"lines"`
	Align string   `json:"align"`
	Caps  bool     `json:"caps"`
}

type Region struct {
	ID          string  `json:"id"`
	PanelID     string  `json:"panelId"`
	Order       int     `json:"order"`
	DetClass    string  `json:"detClass"`
	Score       float64 `json:"score"`
	TextBox     Box     `json:"textBox"`
	BubbleBox   *Box    `json:"bubbleBox,omitempty"`
	Kind        string  `json:"kind,omitempty"`
	Replace     bool    `json:"replace"`
	Source      *Source `json:"source,omitempty"`
	Speaker     string  `json:"speaker,omitempty"`
	OverlayBox  *Box    `json:"overlayBox,omitempty"`
	OverlayURL  string  `json:"overlayUrl,omitempty"`
	FitBox      *Box    `json:"fitBox,omitempty"`
	GlyphHeight int     `json:"glyphHeight,omitempty"`
}

func (r Region) bubbleRect() image.Rectangle {
	if r.BubbleBox == nil {
		return image.Rectangle{}
	}
	return r.BubbleBox.Rect()
}

type Character struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type PanelDescription struct {
	PanelID     string `json:"panelId"`
	Description string `json:"description"`
}

type Scene struct {
	Summary    string             `json:"summary"`
	Characters []Character        `json:"characters"`
	Panels     []PanelDescription `json:"panels"`
	Speakers   map[string]string  `json:"speakers"`
	Notes      []string           `json:"notes"`
}

type TrRegion struct {
	Text     string `json:"text"`
	Literal  string `json:"literal,omitempty"`
	Notes    string `json:"notes,omitempty"`
	MaxChars int    `json:"maxChars,omitempty"`
	MaxLines int    `json:"maxLines,omitempty"`
}

type Translation struct {
	Lang      string              `json:"lang"`
	Final     bool                `json:"final"`
	Edited    bool                `json:"edited"`
	UpdatedAt string              `json:"updatedAt"`
	Regions   map[string]TrRegion `json:"regions"`
	Version   string              `json:"version,omitempty"`
	Label     string              `json:"label,omitempty"`
	Source    string              `json:"source,omitempty"`
	Model     string              `json:"model,omitempty"`
}

type Strip struct {
	Meta     store.Meta        `json:"meta"`
	Panels   []Panel           `json:"panels"`
	Regions  []Region          `json:"regions"`
	Scene    *Scene            `json:"scene,omitempty"`
	Stages   map[string]string `json:"stages"`
	ImageURL string            `json:"imageUrl"`
	CleanURL string            `json:"cleanUrl,omitempty"`
}

type StripSummary struct {
	ID        string   `json:"id"`
	OrigName  string   `json:"origName"`
	CreatedAt string   `json:"createdAt"`
	Width     int      `json:"width"`
	Height    int      `json:"height"`
	ThumbURL  string   `json:"thumbUrl"`
	Langs     []string `json:"langs"`
}

type MetaPayload struct {
	ID       string `json:"id"`
	OrigName string `json:"origName"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	ImageURL string `json:"imageUrl"`
}

type cleanResult struct {
	Rev     int64    `json:"rev"`
	Regions []Region `json:"regions"`
}

type reviewResult struct {
	Critique string `json:"critique"`
}

const (
	StatusRunning = "running"
	StatusDone    = "done"
	StatusCached  = "cached"
	StatusError   = "error"
)

type Progress struct {
	Done  int `json:"done"`
	Total int `json:"total"`
}

type StageEvent struct {
	Stage    string    `json:"stage"`
	Status   string    `json:"status"`
	Message  string    `json:"message,omitempty"`
	Progress *Progress `json:"progress,omitempty"`
}

type DataEvent struct {
	Kind    string `json:"kind"`
	Payload any    `json:"payload"`
}

type Event struct {
	Name string
	Data any
}
