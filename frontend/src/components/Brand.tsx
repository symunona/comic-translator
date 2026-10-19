import { A } from "@solidjs/router";
import { isMock } from "../lib/api";
import Logo from "./Logo";

export default function Brand() {
  return (
    <A href={isMock ? "/?mock=1" : "/"} class="brand">
      <Logo size={30} />
      <span class="brand-name">
        comic<span>·</span>translator
      </span>
    </A>
  );
}
