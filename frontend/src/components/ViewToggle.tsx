export default function ViewToggle(p: { original: boolean; onChange: (original: boolean) => void; disabled?: boolean }) {
  return (
    <div class="view-toggle" role="group" aria-label="Show">
      <button type="button" aria-pressed={p.original} disabled={p.disabled} onClick={() => p.onChange(true)}>
        Original
      </button>
      <button type="button" aria-pressed={!p.original} disabled={p.disabled} onClick={() => p.onChange(false)}>
        Translated
      </button>
    </div>
  );
}
