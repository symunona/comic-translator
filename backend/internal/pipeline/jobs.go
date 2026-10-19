package pipeline

import (
	"context"
	"log"
	"sync"
)

// Job is one pipeline run for (id, lang). Subscribers get every event from the
// start, then live events, until the job ends.
type Job struct {
	mu     sync.Mutex
	events []Event
	subs   map[chan struct{}]struct{}
	done   bool
	status map[string]string
}

func (j *Job) publish(e Event) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.events = append(j.events, e)
	if se, ok := e.Data.(StageEvent); ok && e.Name == "stage" {
		j.status[se.Stage] = se.Status
	}
	j.notify()
}

func (j *Job) finish() {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done = true
	j.notify()
}

func (j *Job) notify() {
	for ch := range j.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Subscribe streams events to fn until the job ends or ctx is cancelled.
func (j *Job) Subscribe(ctx context.Context, fn func(Event) error) error {
	wake := make(chan struct{}, 1)
	j.mu.Lock()
	j.subs[wake] = struct{}{}
	j.mu.Unlock()
	defer func() {
		j.mu.Lock()
		delete(j.subs, wake)
		j.mu.Unlock()
	}()
	next := 0
	for {
		j.mu.Lock()
		pending := j.events[next:]
		next = len(j.events)
		done := j.done
		j.mu.Unlock()
		for _, e := range pending {
			if err := fn(e); err != nil {
				return err
			}
		}
		if done {
			return nil
		}
		select {
		case <-wake:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

type Jobs struct {
	p    *Pipeline
	ctx  context.Context
	mu   sync.Mutex
	jobs map[string]*Job
}

func NewJobs(ctx context.Context, p *Pipeline) *Jobs {
	return &Jobs{p: p, ctx: ctx, jobs: map[string]*Job{}}
}

// Start returns the running job for (id, lang) or starts a new one.
func (m *Jobs) Start(id, lang string) *Job {
	key := id + "/" + lang
	m.mu.Lock()
	defer m.mu.Unlock()
	if j, ok := m.jobs[key]; ok {
		return j
	}
	j := &Job{subs: map[chan struct{}]struct{}{}, status: map[string]string{}}
	m.jobs[key] = j
	go func() {
		err := m.p.Run(m.ctx, id, lang, j.publish)
		if err != nil {
			log.Printf("job %s/%s: %v", id[:min(8, len(id))], lang, err)
			j.publish(Event{"fatal", map[string]string{"message": err.Error()}})
		} else {
			j.publish(Event{"done", struct{}{}})
		}
		m.mu.Lock()
		delete(m.jobs, key)
		m.mu.Unlock()
		j.finish()
	}()
	return j
}

// Running reports live stage statuses of jobs currently running for id.
func (m *Jobs) Running(id string) map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]string{}
	for key, j := range m.jobs {
		if len(key) <= len(id) || key[:len(id)+1] != id+"/" {
			continue
		}
		j.mu.Lock()
		for s, st := range j.status {
			if st == StatusRunning || st == StatusError {
				out[s] = st
			}
		}
		j.mu.Unlock()
	}
	return out
}

// Busy reports whether a job for (id, lang) is running.
func (m *Jobs) Busy(id, lang string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.jobs[id+"/"+lang]
	return ok
}
