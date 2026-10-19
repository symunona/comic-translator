package llm

import (
	"encoding/base64"
	"mime"
	"os"
	"path/filepath"
)

type encodedImage struct {
	mime string
	b64  string
}

func encodeImages(paths []string) ([]encodedImage, error) {
	out := make([]encodedImage, 0, len(paths))
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		mt := mime.TypeByExtension(filepath.Ext(p))
		if mt == "" {
			mt = "image/png"
		}
		out = append(out, encodedImage{mt, base64.StdEncoding.EncodeToString(data)})
	}
	return out, nil
}
