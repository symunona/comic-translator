import { settings } from "../lib/settings";

// ModeToggle switches every step between this computer (free) and SOTA models on
// the user's OpenRouter key. A run in progress picks it up from its next step.
export default function ModeToggle(p: { onChange?: (free: boolean) => void }) {
  const pick = (free: boolean) => {
    settings.setAllFree(free);
    settings.setPathChoice(free ? "free" : "openrouter");
    p.onChange?.(free);
  };
  return (
    <div class="view-toggle mode-toggle" role="group" aria-label="Engine">
      <button type="button" aria-pressed={settings.allFree()} title="On this computer: free, nothing leaves it, rougher" onClick={() => pick(true)}>
        Free
      </button>
      <button
        type="button"
        aria-pressed={!settings.allFree()}
        title={settings.apiKey() ? "SOTA models on your OpenRouter key" : "SOTA models on your OpenRouter key (asks for it)"}
        onClick={() => pick(false)}
      >
        OpenRouter
      </button>
    </div>
  );
}
