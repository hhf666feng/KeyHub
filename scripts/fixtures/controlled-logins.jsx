import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createApp } from "vue/dist/vue.esm-bundler.js";

function ReactLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [revision, setRevision] = useState(0);
  const [done, setDone] = useState(false);
  if (done) return <p id="done">Submitted</p>;
  return <form onSubmit={event => { event.preventDefault(); window.lastSubmit = { username, password }; setDone(true); }}>
    <input id="u" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} />
    <input id="p" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
    <button id="render" type="button" onClick={() => setRevision(revision + 1)}>Render {revision}</button>
    <button id="submit">Sign in</button>
  </form>;
}
if (document.body.dataset.framework === "react") createRoot(document.getElementById("app")).render(<ReactLogin />);
else createApp({
  data: () => ({ username: "", password: "", revision: 0, done: false }),
  methods: { submit() { window.lastSubmit = { username: this.username, password: this.password }; this.done = true; } },
  template: `<p v-if="done" id="done">Submitted</p><form v-else @submit.prevent="submit">
    <input id="u" autocomplete="username" v-model.lazy="username">
    <input id="p" type="password" autocomplete="current-password" v-model="password">
    <button id="render" type="button" @click="revision++">Render {{ revision }}</button>
    <button id="submit">Sign in</button></form>`,
}).mount("#app");
