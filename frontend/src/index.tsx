import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import OAuth from "./pages/OAuth";
import Upload from "./pages/Upload";
import Viewer from "./pages/Viewer";
import Work from "./pages/Work";
import "./styles.css";

render(
  () => (
    <Router>
      <Route path="/" component={Upload} />
      <Route path="/s/:id" component={Work} />
      <Route path="/v/:id" component={Viewer} />
      <Route path="/oauth" component={OAuth} />
    </Router>
  ),
  document.getElementById("root")!,
);
