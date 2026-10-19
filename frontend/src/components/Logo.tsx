export default function Logo(p: { size?: number }) {
  return (
    <svg class="logo" viewBox="0 0 40 34" width={p.size ?? 28} height={((p.size ?? 28) * 34) / 40} aria-hidden="true">
      <path d="M6 2.5h28a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H17l-8.5 6.5 1.8-6.5H6a4 4 0 0 1-4-4v-15a4 4 0 0 1 4-4z" />
      <path class="logo-ink" d="M9 10.5h14M9 16.5h9M27 9.5l4 4-4 4" />
    </svg>
  );
}
