const CODES =
  "af am ar as az be bg bn bo bs ca cs cy da de el en eo es et eu fa fi fil fo fr fy ga gd gl gu ha he hi hr ht hu hy id ig is it ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk ml mn mr ms mt my nb ne nl nn ny oc or pa pl ps pt pt-BR qu rm ro ru rw sa sd si sk sl sm sn so sq sr st su sv sw ta te tg th ti tk tl tn to tr tt ug uk ur uz vi wo xh yi yo zh zh-Hant zu".split(
    " ",
  );

export type Lang = { code: string; name: string; native: string };

const english = new Intl.DisplayNames(["en"], { type: "language" });

function nativeName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function langEnglishName(code: string): string {
  try {
    return english.of(code) ?? code;
  } catch {
    return code;
  }
}

let all: Lang[] | null = null;

export function allLangs(): Lang[] {
  all ??= CODES.map((code) => ({ code, name: langEnglishName(code), native: nativeName(code) })).sort((a, b) => a.name.localeCompare(b.name));
  return all;
}

export function findLang(code: string): Lang {
  return allLangs().find((l) => l.code === code) ?? { code, name: langEnglishName(code), native: nativeName(code) };
}

export const langName = (code: string) => {
  const l = findLang(code);
  return l.native && l.native.toLowerCase() !== l.name.toLowerCase() ? `${l.name} · ${l.native}` : l.name;
};

export function matchLang(l: Lang, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return l.code.toLowerCase().startsWith(s) || l.name.toLowerCase().includes(s) || l.native.toLowerCase().includes(s);
}

export function browserLang(): string {
  const nav = (navigator.language || "en").split("-")[0];
  return CODES.includes(nav) ? nav : "en";
}
