import { render } from "preact";
import "../../public/forecast-ui/styles.css";
import "./components/hints/hints.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}
