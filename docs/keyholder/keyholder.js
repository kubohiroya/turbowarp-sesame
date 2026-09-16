//#region src/ble/share-qr.ts
var e = {
	owner: 0,
	manager: 1,
	guest: 2
};
function t(e) {
	let t = e.trim();
	if (!t.startsWith("ssm://UI")) throw Error("This is not a sesame sharing QR code.");
	let n = new URLSearchParams(t.slice(t.indexOf("?") + 1));
	if (n.get("t") !== "sk") throw Error("This sesame QR code does not share a key. Choose the key sharing code in the sesame app.");
	let s = n.get("sk");
	if (s === null || s.length === 0) throw Error("This sesame QR code carries no key.");
	let c = i(s), l = c[0];
	if (l === void 0) throw Error("This sesame QR code is empty.");
	let u = l >= 5 ? 4 : 64, d = 17 + u + 2 + 16;
	if (c.length !== d) throw Error(`This sesame QR code is ${c.length} bytes, but model ${l} needs ${d}.`);
	let f = 1, p = a(c, f, 16);
	if (p.startsWith("0000000000000000")) throw Error("This is a guest key, which does not contain the half of the secret that Bluetooth needs. Share an owner or manager key instead.");
	f += 16;
	let m = a(c, f, u);
	f += u;
	let h = a(c, f, 2);
	f += 2;
	let g = o(c, f), _ = r(n.get("l")), v = n.get("n") ?? void 0;
	return {
		model: l,
		secret: p,
		publicKey: m,
		keyIndex: h,
		uuid: g,
		..._ === void 0 ? {} : { level: _ },
		...v === void 0 || v.length === 0 ? {} : { name: v }
	};
}
function n(e) {
	return {
		...e,
		secret: "[redacted]"
	};
}
function r(t) {
	if (t === null) return;
	let n = Number.parseInt(t, 10);
	for (let [t, r] of Object.entries(e)) if (r === n) return t;
}
function i(e) {
	let t = e.replace(/-/gu, "+").replace(/_/gu, "/"), n;
	try {
		n = atob(t);
	} catch {
		throw Error("This sesame QR code is not valid base64.");
	}
	return Uint8Array.from(n, (e) => e.charCodeAt(0));
}
function a(e, t, n) {
	let r = "";
	for (let i = t; i < t + n; i += 1) r += (e[i] ?? 0).toString(16).padStart(2, "0");
	return r;
}
function o(e, t) {
	let n = a(e, t, 16).toUpperCase();
	return [
		n.slice(0, 8),
		n.slice(8, 12),
		n.slice(12, 16),
		n.slice(16, 20),
		n.slice(20, 32)
	].join("-");
}
//#endregion
//#region src/keyholder/kek.ts
var s = 6e5, c = {
	name: "AES-GCM",
	length: 256
}, l = new TextEncoder().encode("sesame-keyholder/kek/v1");
function u() {
	return globalThis.PublicKeyCredential !== void 0 && typeof navigator < "u" && typeof navigator.credentials?.get == "function";
}
async function d(e, t = crypto.subtle) {
	let n = await navigator.credentials.create({ publicKey: {
		challenge: crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)),
		rp: { name: "Sesame keyholder" },
		user: {
			id: crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)),
			name: e,
			displayName: `Sesame ${e}`
		},
		pubKeyCredParams: [{
			type: "public-key",
			alg: -7
		}, {
			type: "public-key",
			alg: -257
		}],
		authenticatorSelection: {
			residentKey: "required",
			userVerification: "required"
		},
		extensions: { prf: {} }
	} });
	if (n === null) throw Error("No passkey was created.");
	if (n.getClientExtensionResults().prf?.enabled === !1) throw Error("This passkey cannot protect a key. Use a passphrase instead.");
	return {
		credentialId: new Uint8Array(n.rawId),
		salt: crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32))
	};
}
async function f(e, t, n = crypto.subtle) {
	let r = (await navigator.credentials.get({ publicKey: {
		challenge: crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)),
		allowCredentials: [{
			type: "public-key",
			id: g(e)
		}],
		userVerification: "required",
		extensions: { prf: { eval: { first: g(t) } } }
	} }))?.getClientExtensionResults().prf?.results?.first;
	if (r === void 0) throw Error("This passkey did not return key material. Pair again with a passphrase.");
	return h(new Uint8Array(r), t, n);
}
async function p(e, t, n = s, r = crypto.subtle) {
	if (e.length < 8) throw TypeError("A passphrase must be at least eight characters.");
	let i = await r.importKey("raw", g(new TextEncoder().encode(e)), "PBKDF2", !1, ["deriveKey"]);
	return r.deriveKey({
		name: "PBKDF2",
		salt: g(t),
		iterations: n,
		hash: "SHA-256"
	}, i, c, !1, ["wrapKey", "unwrapKey"]);
}
async function m(e, t, n = crypto.subtle) {
	return e.kind === "webauthn-prf" ? f(e.credentialId, e.salt, n) : p(await t(), e.salt, e.iterations, n);
}
async function h(e, t, n) {
	let r = await n.importKey("raw", g(e), "HKDF", !1, ["deriveKey"]);
	return e.fill(0), n.deriveKey({
		name: "HKDF",
		hash: "SHA-256",
		salt: g(t),
		info: g(l)
	}, r, c, !1, ["wrapKey", "unwrapKey"]);
}
function g(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/keyholder/scan.ts
async function _() {
	let e = y();
	if (e === void 0) return !1;
	try {
		return (await e.getSupportedFormats?.() ?? ["qr_code"]).includes("qr_code");
	} catch {
		return !1;
	}
}
async function v(e = 6e4, t = 200) {
	let n = y();
	if (n === void 0) throw Error("This browser cannot read a QR code from the camera. Paste the code's text instead.");
	let r = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }), i = document.createElement("video");
	i.srcObject = r, i.muted = !0, i.playsInline = !0, await i.play();
	let a = new n({ formats: ["qr_code"] }), o = () => void 0;
	return {
		result: new Promise((n, s) => {
			let c = (e) => {
				o(), e();
			}, l = setTimeout(() => {
				c(() => {
					s(/* @__PURE__ */ Error("No QR code was found. Try again."));
				});
			}, e), u = setInterval(() => {
				(async () => {
					try {
						let e = (await a.detect(i))[0]?.rawValue;
						e !== void 0 && e.length > 0 && c(() => {
							n(e);
						});
					} catch {}
				})();
			}, t);
			o = () => {
				clearTimeout(l), clearInterval(u);
				for (let e of r.getTracks()) e.stop();
				i.srcObject = null;
			};
		}),
		stream: r,
		cancel: () => {
			o();
		}
	};
}
function y() {
	return globalThis.BarcodeDetector;
}
//#endregion
//#region src/aes-cmac.ts
var b = 16, ee = 135;
async function te(e, t, n = crypto.subtle) {
	let r = async (t) => {
		let r = await n.encrypt({
			name: "AES-CBC",
			iv: new Uint8Array(b)
		}, e, re(t));
		return new Uint8Array(r).slice(0, b);
	}, i = new Uint8Array(b), a = x(await r(i)), o = x(a), s = Math.max(1, Math.ceil(t.length / b)), c = t.length > 0 && t.length % b === 0, l = i;
	for (let e = 0; e < s - 1; e += 1) {
		let n = t.slice(e * b, (e + 1) * b);
		l = await r(S(l, n));
	}
	let u = (s - 1) * b, d = c ? S(t.slice(u, u + b), a) : S(ne(t.slice(u)), o);
	return r(S(l, d));
}
function x(e) {
	let t = new Uint8Array(b), n = 0;
	for (let r = 15; r >= 0; --r) {
		let i = e[r] ?? 0;
		t[r] = i << 1 & 255 | n, n = i & 128 ? 1 : 0;
	}
	return n !== 0 && (t[15] = (t[15] ?? 0) ^ ee), t;
}
function ne(e) {
	let t = new Uint8Array(b);
	return t.set(e), t[e.length] = 128, t;
}
function S(e, t) {
	let n = new Uint8Array(b);
	for (let r = 0; r < b; r += 1) n[r] = (e[r] ?? 0) ^ (t[r] ?? 0);
	return n;
}
function re(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/ble/aes-ccm.ts
var C = 16;
async function ie(e, t = crypto.subtle) {
	let n = M(e), [r, i] = await Promise.all([t.importKey("raw", n, { name: "AES-CBC" }, !1, ["encrypt"]), t.importKey("raw", n, { name: "AES-CTR" }, !1, ["encrypt"])]);
	return {
		cbc: r,
		ctr: i
	};
}
async function ae(e, t, n = crypto.subtle) {
	let r = w(e, t.length), i = await T(r, t, n), a = await E(r, t.length, n);
	return {
		ciphertext: A(t, a.subarray(C)),
		tag: A(i, a.subarray(0, r.tagLength))
	};
}
async function oe(e, t, n, r = crypto.subtle) {
	let i = w(e, t.length);
	if (n.length !== i.tagLength) throw Error(`AES-CCM tag must be ${i.tagLength} bytes, received ${n.length}.`);
	let a = await E(i, t.length, r), o = A(t, a.subarray(C));
	if (!j(A(await T(i, o, r), a.subarray(0, i.tagLength)), n)) throw Error("AES-CCM authentication tag mismatch.");
	return o;
}
async function se(e, t, n = crypto.subtle) {
	let { ciphertext: r, tag: i } = await ae(e, t, n), a = new Uint8Array(r.length + i.length);
	return a.set(r), a.set(i, r.length), a;
}
async function ce(e, t, n = crypto.subtle) {
	let r = e.tagLength ?? 4;
	if (t.length < r) throw Error("AES-CCM frame is shorter than its authentication tag.");
	let i = t.length - r;
	return oe(e, t.subarray(0, i), t.subarray(i), n);
}
function w(e, t) {
	let n = e.tagLength ?? 4;
	if (n < 4 || n > 16 || n % 2 != 0) throw TypeError("AES-CCM tag length must be an even number of bytes from 4 to 16.");
	let r = e.nonce.length;
	if (r < 7 || r > 13) throw TypeError("AES-CCM nonce must be 7 to 13 bytes.");
	let i = 15 - r;
	if (i < 8 && t >= 2 ** (8 * i)) throw TypeError(`AES-CCM payload of ${t} bytes does not fit a ${i}-byte length field.`);
	return {
		key: e.key,
		nonce: e.nonce,
		additionalData: e.additionalData ?? /* @__PURE__ */ new Uint8Array(),
		tagLength: n,
		lengthSize: i
	};
}
async function T(e, t, n) {
	let r = ue([
		le(e, t.length),
		D(e.additionalData),
		O(t)
	]), i = new Uint8Array(await n.encrypt({
		name: "AES-CBC",
		iv: new Uint8Array(C)
	}, e.key.cbc, M(r))), a = i.length - C;
	return i.slice(a - C, a - C + e.tagLength);
}
async function E(e, t, n) {
	let r = new Uint8Array(C);
	r[0] = e.lengthSize - 1, r.set(e.nonce, 1);
	let i = Math.ceil(t / C) + 1, a = await n.encrypt({
		name: "AES-CTR",
		counter: r,
		length: e.lengthSize * 8
	}, e.key.ctr, /* @__PURE__ */ new ArrayBuffer(i * C));
	return new Uint8Array(a);
}
function le(e, t) {
	let n = new Uint8Array(C);
	return n[0] = (e.additionalData.length > 0) * 64 + (e.tagLength - 2) / 2 * 8 + (e.lengthSize - 1), n.set(e.nonce, 1), k(n, C - e.lengthSize, t), n;
}
function D(e) {
	if (e.length === 0) return /* @__PURE__ */ new Uint8Array();
	if (e.length >= 65280) throw TypeError("AES-CCM additional data above 65280 bytes is not supported.");
	let t = new Uint8Array(e.length + 2);
	return k(t, 0, e.length, 2), t.set(e, 2), O(t);
}
function O(e) {
	if (e.length % C === 0) return e;
	let t = new Uint8Array(Math.ceil(e.length / C) * C);
	return t.set(e), t;
}
function k(e, t, n, r = e.length - t) {
	let i = n;
	for (let n = r - 1; n >= 0; --n) e[t + n] = i & 255, i = Math.floor(i / 256);
}
function ue(e) {
	let t = e.reduce((e, t) => e + t.length, 0), n = new Uint8Array(t), r = 0;
	for (let t of e) n.set(t, r), r += t.length;
	return n;
}
function A(e, t) {
	let n = new Uint8Array(e.length);
	for (let r = 0; r < e.length; r += 1) n[r] = (e[r] ?? 0) ^ (t[r] ?? 0);
	return n;
}
function j(e, t) {
	if (e.length !== t.length) return !1;
	let n = 0;
	for (let r = 0; r < e.length; r += 1) n |= (e[r] ?? 0) ^ (t[r] ?? 0);
	return n === 0;
}
function M(e) {
	return e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength);
}
//#endregion
//#region src/ble/protocol.ts
var N = {
	registration: 1,
	login: 2,
	history: 4,
	versionDetail: 5,
	time: 8,
	autolock: 11,
	initial: 14,
	magnet: 17,
	mechSetting: 80,
	mechStatus: 81,
	lock: 82,
	unlock: 83,
	reset: 104
};
N.lock, N.unlock;
function P(e, t) {
	if (t.length !== 4) throw TypeError("Sesame session random code must be four bytes.");
	let n = /* @__PURE__ */ new Uint8Array(13);
	return new DataView(n.buffer).setBigInt64(0, BigInt(e), !0), n.set(t, 9), n;
}
var de = 1, fe = 2, pe = 4;
function me(e, t = 20) {
	let n = F(t), r = e.parsing === "cipher" ? pe : fe, i = [], a = Math.max(1, Math.ceil(e.data.length / n));
	for (let t = 0; t < a; t += 1) {
		let o = e.data.subarray(t * n, (t + 1) * n), s = (t === 0 ? de : 0) | (t === a - 1 ? r : 0), c = new Uint8Array(o.length + 1);
		c[0] = s, c.set(o, 1), i.push(c);
	}
	return i;
}
function F(e) {
	if (!Number.isInteger(e) || e < 2) throw TypeError("Sesame BLE packet size must be an integer above one.");
	return e - 1;
}
//#endregion
//#region src/ble/keyholder-session.ts
var I = new Uint8Array([0]), L = 4, R = 4;
async function z(e, t, n = crypto.subtle) {
	if (t.length !== 4) throw TypeError("Sesame session random code must be four bytes.");
	let r = await te(e, t, n), i = await ie(r, n), a = r.slice(0, R);
	return r.fill(0), {
		session: new B(i, t, n),
		loginProof: a
	};
}
var B = class {
	constructor(e, t, n) {
		this.randomCode = t, this.subtle = n, this.sentCount = 0, this.receivedCount = 0, this.closed = !1, this.key = e;
	}
	async seal(e) {
		let t = await se({
			key: this.requireOpen(),
			nonce: P(this.sentCount, this.randomCode),
			additionalData: I,
			tagLength: L
		}, e, this.subtle);
		return this.sentCount += 1, me({
			parsing: "cipher",
			data: t
		});
	}
	async open(e, t) {
		let n = this.requireOpen();
		if (e === "plain") return t;
		let r = await ce({
			key: n,
			nonce: P(this.receivedCount, this.randomCode),
			additionalData: I,
			tagLength: L
		}, t, this.subtle);
		return this.receivedCount += 1, r;
	}
	close() {
		return this.closed = !0, this.key = void 0, Promise.resolve();
	}
	requireOpen() {
		if (this.closed || this.key === void 0) throw Error("This Sesame session is closed.");
		return this.key;
	}
}, he = 4, ge = class {
	constructor(e) {
		this.backend = e, this.sessions = /* @__PURE__ */ new Map(), this.nextSessionId = 1;
	}
	listen(e) {
		e.onmessage = (t) => {
			this.dispatch(e, t.data);
		}, e.start?.(), e.postMessage({ ready: !0 });
	}
	async close() {
		let e = [...this.sessions.values()];
		this.sessions.clear(), await Promise.all(e.map((e) => e.close()));
	}
	async dispatch(e, t) {
		if (t !== null && typeof t.id == "number") try {
			let n = await this.handle(t.method, t.params);
			e.postMessage({
				id: t.id,
				ok: !0,
				value: n
			});
		} catch (n) {
			e.postMessage({
				id: t.id,
				ok: !1,
				error: n instanceof Error ? n.message : String(n)
			});
		}
	}
	async handle(e, t) {
		let n = _e(t);
		switch (e) {
			case "isPaired": return this.backend.isPaired(V(n.deviceName, "deviceName"));
			case "pair": return this.backend.pair();
			case "startSession": return this.startSession(V(n.deviceName, "deviceName"), H(n.randomCode, "randomCode"));
			case "seal": return this.session(n).seal(H(n.message, "message"));
			case "open": return this.session(n).open(ve(n.parsing), H(n.data, "data"));
			case "closeSession": return this.closeSession(V(n.sessionId, "sessionId"));
			default: throw Error(`Unknown keyholder request: ${e}.`);
		}
	}
	async startSession(e, t) {
		if (this.sessions.size >= he) throw Error("Too many Sesame sessions are open.");
		let { session: n, loginProof: r } = await z(await this.backend.unlock(e), t), i = `s${String(this.nextSessionId)}`;
		return this.nextSessionId += 1, this.sessions.set(i, n), {
			sessionId: i,
			loginProof: r
		};
	}
	async closeSession(e) {
		let t = this.sessions.get(e);
		return this.sessions.delete(e), await t?.close(), null;
	}
	session(e) {
		let t = V(e.sessionId, "sessionId"), n = this.sessions.get(t);
		if (n === void 0) throw Error("That Sesame session is not open.");
		return n;
	}
};
function _e(e) {
	return typeof e == "object" && e && !Array.isArray(e) ? e : {};
}
function V(e, t) {
	if (typeof e != "string" || e.length === 0) throw TypeError(`The ${t} is missing.`);
	return e;
}
function H(e, t) {
	if (e instanceof Uint8Array) return e;
	if (e instanceof ArrayBuffer) return new Uint8Array(e);
	throw TypeError(`The ${t} must be bytes.`);
}
function ve(e) {
	if (e === "plain" || e === "cipher") return e;
	throw TypeError("The parsing type must be plain or cipher.");
}
//#endregion
//#region src/keyholder/storage.ts
var ye = "sesame-keyholder", U = "devices", be = 1, xe = class {
	async get(e) {
		return this.run("readonly", (t) => t.get(e));
	}
	async put(e) {
		await this.run("readwrite", (t) => t.put(e));
	}
	async list() {
		return await this.run("readonly", (e) => e.getAll());
	}
	async delete(e) {
		await this.run("readwrite", (t) => t.delete(e));
	}
	open() {
		return this.database ?? (this.database = new Promise((e, t) => {
			let n = indexedDB.open(ye, be);
			n.onupgradeneeded = () => {
				n.result.createObjectStore(U, { keyPath: "deviceName" });
			}, n.onsuccess = () => {
				e(n.result);
			}, n.onerror = () => {
				t(/* @__PURE__ */ Error("This browser will not store keys. Private windows and blocked site data prevent it."));
			};
		})), this.database;
	}
	async run(e, t) {
		let n = await this.open();
		return new Promise((r, i) => {
			let a = t(n.transaction(U, e).objectStore(U));
			a.onsuccess = () => {
				r(a.result);
			}, a.onerror = () => {
				i(/* @__PURE__ */ Error("The keyholder could not reach its storage."));
			};
		});
	}
}, W = "AES-GCM", Se = 12, Ce = class {
	constructor(e, t = crypto.subtle, n = (e) => crypto.getRandomValues(new Uint8Array(e))) {
		this.storage = e, this.subtle = t, this.randomBytes = n;
	}
	async pair(e, t, n, r) {
		let i = G(e), a = we(t.secret), o = await this.subtle.importKey("raw", q(a), { name: "AES-CBC" }, !0, ["encrypt"]);
		a.fill(0);
		let s = this.randomBytes(Se), c = new Uint8Array(await this.subtle.wrapKey("raw", o, n, {
			name: W,
			iv: q(s)
		})), l = {
			deviceName: i,
			uuid: t.uuid,
			model: t.model,
			publicKey: t.publicKey,
			...t.level === void 0 ? {} : { level: t.level },
			wrappedSecret: c,
			wrapIv: s,
			protection: r,
			pairedAt: Date.now()
		};
		return await this.storage.put(l), K(l);
	}
	async protectionFor(e) {
		return (await this.require(G(e))).protection;
	}
	async unlock(e, t) {
		let n = await this.require(G(e));
		try {
			return await this.subtle.unwrapKey("raw", q(n.wrappedSecret), t, {
				name: W,
				iv: q(n.wrapIv)
			}, { name: "AES-CBC" }, !1, ["encrypt"]);
		} catch {
			throw Error("The key could not be unlocked. Use the same passkey or passphrase that paired it.");
		}
	}
	async has(e) {
		return await this.storage.get(G(e)) !== void 0;
	}
	async list() {
		return (await this.storage.list()).map(K);
	}
	async forget(e) {
		await this.storage.delete(G(e));
	}
	async require(e) {
		let t = await this.storage.get(e);
		if (t === void 0) throw Error(`No Sesame is paired as "${e}".`);
		return t;
	}
};
function G(e) {
	let t = e.trim().toLowerCase().replace(/\s+/gu, "-");
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(t)) throw TypeError("A device alias must start with a letter or digit and use only letters, digits, dot, dash, or underscore.");
	return t;
}
function K(e) {
	return {
		deviceName: e.deviceName,
		uuid: e.uuid,
		...e.level === void 0 ? {} : { level: e.level },
		pairedAt: e.pairedAt
	};
}
function we(e) {
	return Uint8Array.from(e.match(/.{2}/gu) ?? [], (e) => Number.parseInt(e, 16));
}
function q(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/keyholder/main.ts
var J = new Ce(new xe()), Y = (e) => {
	let t = document.getElementById(e);
	if (t === null) throw Error(`The keyholder page is missing #${e}.`);
	return t;
}, X = (e, t = "info") => {
	let n = Y("status");
	n.textContent = e, n.dataset.kind = t;
}, Te = new ge({
	isPaired: (e) => J.has(e),
	unlock: async (e) => {
		let t = await J.protectionFor(e);
		X(t.kind === "webauthn-prf" ? `Confirm to unlock "${e}".` : `Enter the passphrase for "${e}".`);
		let n = await m(t, Z), r = await J.unlock(e, n);
		return X(`Session open for "${e}".`), r;
	},
	pair: async () => {
		throw Error("Open the keyholder page itself to pair a Sesame, then return to TurboWarp.");
	}
});
window.addEventListener("message", (e) => {
	let t = e.data, n = e.ports[0];
	t?.sesameKeyholder === 1 && n !== void 0 && (Te.listen(n), Y("embedded").hidden = !1);
});
async function Z() {
	let e = Y("passphrase").value;
	if (e.length === 0) throw Y("passphrase-row").hidden = !1, Error("Enter the passphrase above, then try again.");
	return Promise.resolve(e);
}
async function Q() {
	let e = Y("devices"), t = await J.list();
	e.replaceChildren(...t.map((e) => Ee(e))), Y("empty").hidden = t.length > 0;
}
function Ee(e) {
	let t = document.createElement("li"), n = document.createElement("strong");
	n.textContent = e.deviceName;
	let r = document.createElement("span");
	r.textContent = `${e.uuid}${e.level === void 0 ? "" : ` · ${e.level} key`}`;
	let i = document.createElement("button");
	return i.type = "button", i.textContent = "Forget", i.addEventListener("click", () => {
		(async () => {
			await J.forget(e.deviceName), X(`Forgot "${e.deviceName}".`), await Q();
		})();
	}), t.append(n, r, i), t;
}
async function $(e) {
	let r;
	try {
		r = t(e);
	} catch (e) {
		X(e instanceof Error ? e.message : String(e), "error");
		return;
	}
	let i = G(Y("alias").value || (r.name ?? "sesame")), a = u() && Y("use-passkey").checked;
	try {
		if (a) {
			X("Confirm with your passkey to protect this key.");
			let { credentialId: e, salt: t } = await d(i), n = await f(e, t);
			await J.pair(i, r, n, {
				kind: "webauthn-prf",
				credentialId: e,
				salt: t
			});
		} else {
			let e = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)), t = await p(await Z(), e, s);
			await J.pair(i, r, t, {
				kind: "passphrase",
				salt: e,
				iterations: s
			});
		}
		X(`Paired "${i}" (${n(r).uuid}).`), Y("paste").value = "", Y("passphrase").value = "", await Q();
	} catch (e) {
		X(e instanceof Error ? e.message : String(e), "error");
	}
}
function De() {
	Y("scan").addEventListener("click", () => {
		(async () => {
			let e = Y("preview");
			try {
				X("Point the camera at the sharing QR code.");
				let t = await v();
				e.srcObject = t.stream, e.hidden = !1, await e.play();
				let n = await t.result;
				e.hidden = !0, e.srcObject = null, await $(n);
			} catch (t) {
				e.hidden = !0, e.srcObject = null, X(t instanceof Error ? t.message : String(t), "error");
			}
		})();
	}), Y("use-pasted").addEventListener("click", () => {
		$(Y("paste").value);
	}), Y("use-passkey").addEventListener("change", () => {
		Y("passphrase-row").hidden = Y("use-passkey").checked;
	});
}
async function Oe() {
	De();
	let e = u(), t = Y("use-passkey");
	t.checked = e, t.disabled = !e, Y("passphrase-row").hidden = e, Y("no-passkeys").hidden = e, Y("scan").hidden = !await _(), Y("no-camera").hidden = !Y("scan").hidden, await Q(), X("Ready.");
}
Oe().catch((e) => {
	X(e instanceof Error ? e.message : String(e), "error");
});
//#endregion
