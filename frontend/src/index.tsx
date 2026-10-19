import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { ready } from "./lib/api";
import Upload from "./pages/Upload";
import Work from "./pages/Work";
import "./styles.css";

ready.then(() =>
  render(
    () => (
      <Router>
        <Route path="/" component={Upload} />
        <Route path="/s/:id" component={Work} />
      </Router>
    ),
    document.getElementById("root")!,
  ),
);
