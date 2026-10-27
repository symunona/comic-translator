import { A } from "@solidjs/router";
import Logo from "./Logo";

export default function Brand() {
  return (
    <A href="/" class="brand">
      <Logo size={30} />
      <span class="brand-name">
        comic<span>·</span>translator
      </span>
    </A>
  );
}
