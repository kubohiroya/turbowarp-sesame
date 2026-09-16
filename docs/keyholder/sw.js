//#region src/keyholder/sw-policy.ts
var e = ["index.html", "keyholder.js"];
function t(e, t) {
	if (e.method !== "GET") return;
	let n, r;
	try {
		n = new URL(e.url), r = new URL(t);
	} catch {
		return;
	}
	if (n.origin !== r.origin || !n.pathname.startsWith(r.pathname)) return;
	if (e.mode === "navigate") return "index.html";
	let i = n.pathname.slice(r.pathname.length);
	if (i === "" || i === "index.html") return "index.html";
	if (i === "keyholder.js") return "keyholder.js";
}
function n(e) {
	return `sesame-keyholder-${e}`;
}
function r(e, t) {
	return e.filter((e) => e.startsWith("sesame-keyholder-") && e !== t);
}
//#endregion
//#region src/keyholder/service-worker.ts
var i = n("05239e3255faa8f2"), a = self;
a.addEventListener("install", ((t) => {
	t.waitUntil((async () => {
		await (await caches.open(i)).addAll(e.map((e) => new Request(e, { cache: "reload" }))), await a.skipWaiting();
	})());
})), a.addEventListener("activate", ((e) => {
	e.waitUntil((async () => {
		let e = await caches.keys();
		await Promise.all(r(e, i).map((e) => caches.delete(e))), await a.clients.claim();
	})());
})), a.addEventListener("fetch", ((e) => {
	let n = t({
		url: e.request.url,
		method: e.request.method,
		mode: e.request.mode
	}, a.registration.scope);
	n !== void 0 && e.respondWith((async () => {
		let e = await caches.open(i), t = await e.match(n);
		if (t !== void 0) return t;
		let r = await fetch(n, { cache: "reload" });
		return r.ok && await e.put(n, r.clone()), r;
	})());
}));
//#endregion
