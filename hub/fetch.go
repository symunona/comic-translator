package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

const maxImageBytes = 30 << 20

var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true, "image/avif": true}

var errPrivate = errors.New("address not allowed")

// publicOnly refuses connections to loopback, private, link-local and other
// non-public addresses, after DNS resolution, so a link cannot reach the box's
// own network.
func publicOnly(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || isCGNAT(ip) {
		return errPrivate
	}
	return nil
}

func isCGNAT(ip net.IP) bool {
	v4 := ip.To4()
	return v4 != nil && v4[0] == 100 && v4[1]&0xc0 == 64
}

var fetchClient = &http.Client{
	Timeout: 20 * time.Second,
	Transport: &http.Transport{
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second, Control: publicOnly}).DialContext,
		TLSHandshakeTimeout: 5 * time.Second,
		MaxIdleConns:        10,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errors.New("bad redirect")
		}
		return nil
	},
}

// fetchImage downloads an image for the browser, which cannot read most
// cross-origin images itself. Only public http(s) addresses, only images.
func fetchImage(raw string) ([]byte, string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, "", errors.New("not an http(s) link")
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "comic-translator/1 (+https://comic.tmpx.space)")
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*")
	resp, err := fetchClient.Do(req)
	if err != nil {
		if errors.Is(err, errPrivate) {
			return nil, "", errPrivate
		}
		return nil, "", fmt.Errorf("could not fetch the link: %v", errors.Unwrap(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("the link answered %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > maxImageBytes {
		return nil, "", errors.New("image is over 30 MB")
	}
	mime := sniff(data)
	if !imageTypes[mime] {
		return nil, "", errors.New("the link is not a PNG, JPG, WebP, GIF or AVIF image")
	}
	return data, mime, nil
}

func sniff(data []byte) string {
	if len(data) > 12 && bytes.Equal(data[4:8], []byte("ftyp")) && strings.HasPrefix(string(data[8:12]), "avi") {
		return "image/avif"
	}
	return http.DetectContentType(data)
}
