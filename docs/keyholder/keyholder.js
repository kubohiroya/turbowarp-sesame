//#region src/ble/share-qr.ts
var e = "0000000000000000", t = {
	owner: 0,
	manager: 1,
	guest: 2
};
function n(t) {
	let n = t.trim();
	if (!n.startsWith("ssm://UI")) throw Error("This is not a sesame sharing QR code.");
	let r = new URLSearchParams(n.slice(n.indexOf("?") + 1));
	if (r.get("t") !== "sk") throw Error("This sesame QR code does not share a key. Choose the key sharing code in the sesame app.");
	let i = r.get("sk");
	if (i === null || i.length === 0) throw Error("This sesame QR code carries no key.");
	let u = s(i), d = u[0];
	if (d === void 0) throw Error("This sesame QR code is empty.");
	if (d > 20) throw Error(`This sesame QR code is in a format this project does not know: ${a(u)}. It is not the "share a key" code — see docs/device-testing.md.`);
	let f = d >= 5 ? 4 : 64, p = 17 + f + 2 + 16;
	if (u.length !== p) throw Error(`This sesame QR code is ${u.length} bytes, but model ${d} needs ${p}. ${a(u)}`);
	let m = 1, h = c(u, m, 16);
	if (h.startsWith(e)) throw Error("This is a guest key, which does not contain the half of the secret that Bluetooth needs. Share an owner or manager key instead.");
	m += 16;
	let g = c(u, m, f);
	m += f;
	let _ = c(u, m, 2);
	m += 2;
	let v = l(u, m), y = o(r.get("l")), b = r.get("n") ?? void 0;
	return {
		model: d,
		secret: h,
		publicKey: g,
		keyIndex: _,
		uuid: v,
		...y === void 0 ? {} : { level: y },
		...b === void 0 || b.length === 0 ? {} : { name: b }
	};
}
function r(t) {
	let n = t.secret.trim().toLowerCase().replace(/\s+/gu, "");
	if (!/^[0-9a-f]{32}$/u.test(n)) throw Error("The secret key must be exactly 32 hexadecimal characters.");
	if (n.startsWith(e)) throw Error("That is a guest key's secret, which is missing the half Bluetooth needs. Use an owner or manager key.");
	let r = t.uuid.trim().toUpperCase();
	if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/u.test(r)) throw Error("The device UUID must look like 00000000-0000-0000-0000-000000000000.");
	let i = t.model ?? 5;
	if (!Number.isInteger(i) || i < 0 || i > 20) throw Error(`Unknown product model: ${String(i)}.`);
	let a = t.name?.trim();
	return {
		model: i,
		secret: n,
		publicKey: t.publicKey ?? "",
		keyIndex: "",
		uuid: r,
		...a === void 0 || a.length === 0 ? {} : { name: a }
	};
}
function i(e) {
	return {
		...e,
		secret: "[redacted]"
	};
}
function a(e) {
	let t = Array.from(e.subarray(0, 4), (e) => e.toString(16).padStart(2, "0")).join(" ");
	return `${e.length} bytes beginning ${t}`;
}
function o(e) {
	if (e === null) return;
	let n = Number.parseInt(e, 10);
	for (let [e, r] of Object.entries(t)) if (r === n) return e;
}
function s(e) {
	let t = e.replace(/ /gu, "+").replace(/-/gu, "+").replace(/_/gu, "/"), n;
	try {
		n = atob(t);
	} catch {
		throw Error("This sesame QR code is not valid base64.");
	}
	return Uint8Array.from(n, (e) => e.charCodeAt(0));
}
function c(e, t, n) {
	let r = "";
	for (let i = t; i < t + n; i += 1) r += (e[i] ?? 0).toString(16).padStart(2, "0");
	return r;
}
function l(e, t) {
	let n = c(e, t, 16).toUpperCase();
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
var u = 6e5, d = {
	name: "AES-GCM",
	length: 256
}, f = new TextEncoder().encode("sesame-keyholder/kek/v1");
function p() {
	return globalThis.PublicKeyCredential !== void 0 && typeof navigator < "u" && typeof navigator.credentials?.get == "function";
}
async function m(e, t = crypto.subtle) {
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
async function h(e, t, n = crypto.subtle) {
	let r = (await navigator.credentials.get({ publicKey: {
		challenge: crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)),
		allowCredentials: [{
			type: "public-key",
			id: y(e)
		}],
		userVerification: "required",
		extensions: { prf: { eval: { first: y(t) } } }
	} }))?.getClientExtensionResults().prf?.results?.first;
	if (r === void 0) throw Error("This passkey did not return key material. Pair again with a passphrase.");
	return v(new Uint8Array(r), t, n);
}
async function g(e, t, n = u, r = crypto.subtle) {
	if (e.length < 8) throw TypeError("A passphrase must be at least eight characters.");
	let i = await r.importKey("raw", y(new TextEncoder().encode(e)), "PBKDF2", !1, ["deriveKey"]);
	return r.deriveKey({
		name: "PBKDF2",
		salt: y(t),
		iterations: n,
		hash: "SHA-256"
	}, i, d, !1, ["wrapKey", "unwrapKey"]);
}
async function _(e, t, n = crypto.subtle) {
	return e.kind === "webauthn-prf" ? h(e.credentialId, e.salt, n) : g(await t(), e.salt, e.iterations, n);
}
async function v(e, t, n) {
	let r = await n.importKey("raw", y(e), "HKDF", !1, ["deriveKey"]);
	return e.fill(0), n.deriveKey({
		name: "HKDF",
		hash: "SHA-256",
		salt: y(t),
		info: y(f)
	}, r, d, !1, ["wrapKey", "unwrapKey"]);
}
function y(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/keyholder/scan.ts
async function b() {
	let e = x();
	if (e === void 0) return !1;
	try {
		return (await e.getSupportedFormats?.() ?? ["qr_code"]).includes("qr_code");
	} catch {
		return !1;
	}
}
async function ee(e = 6e4, t = 200) {
	let n = x();
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
function x() {
	return globalThis.BarcodeDetector;
}
//#endregion
//#region src/aes-cmac.ts
var S = 16, te = 135;
async function ne(e, t, n = crypto.subtle) {
	let r = async (t) => {
		let r = await n.encrypt({
			name: "AES-CBC",
			iv: new Uint8Array(S)
		}, e, ie(t));
		return new Uint8Array(r).slice(0, S);
	}, i = new Uint8Array(S), a = C(await r(i)), o = C(a), s = Math.max(1, Math.ceil(t.length / S)), c = t.length > 0 && t.length % S === 0, l = i;
	for (let e = 0; e < s - 1; e += 1) {
		let n = t.slice(e * S, (e + 1) * S);
		l = await r(w(l, n));
	}
	let u = (s - 1) * S, d = c ? w(t.slice(u, u + S), a) : w(re(t.slice(u)), o);
	return r(w(l, d));
}
function C(e) {
	let t = new Uint8Array(S), n = 0;
	for (let r = 15; r >= 0; --r) {
		let i = e[r] ?? 0;
		t[r] = i << 1 & 255 | n, n = i & 128 ? 1 : 0;
	}
	return n !== 0 && (t[15] = (t[15] ?? 0) ^ te), t;
}
function re(e) {
	let t = new Uint8Array(S);
	return t.set(e), t[e.length] = 128, t;
}
function w(e, t) {
	let n = new Uint8Array(S);
	for (let r = 0; r < S; r += 1) n[r] = (e[r] ?? 0) ^ (t[r] ?? 0);
	return n;
}
function ie(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/ble/aes-ccm.ts
var T = 16;
async function ae(e, t = crypto.subtle) {
	let n = N(e), [r, i] = await Promise.all([t.importKey("raw", n, { name: "AES-CBC" }, !1, ["encrypt"]), t.importKey("raw", n, { name: "AES-CTR" }, !1, ["encrypt"])]);
	return {
		cbc: r,
		ctr: i
	};
}
async function oe(e, t, n = crypto.subtle) {
	let r = E(e, t.length), i = await D(r, t, n), a = await O(r, t.length, n);
	return {
		ciphertext: M(t, a.subarray(T)),
		tag: M(i, a.subarray(0, r.tagLength))
	};
}
async function se(e, t, n, r = crypto.subtle) {
	let i = E(e, t.length);
	if (n.length !== i.tagLength) throw Error(`AES-CCM tag must be ${i.tagLength} bytes, received ${n.length}.`);
	let a = await O(i, t.length, r), o = M(t, a.subarray(T));
	if (!fe(M(await D(i, o, r), a.subarray(0, i.tagLength)), n)) throw Error("AES-CCM authentication tag mismatch.");
	return o;
}
async function ce(e, t, n = crypto.subtle) {
	let { ciphertext: r, tag: i } = await oe(e, t, n), a = new Uint8Array(r.length + i.length);
	return a.set(r), a.set(i, r.length), a;
}
async function le(e, t, n = crypto.subtle) {
	let r = e.tagLength ?? 4;
	if (t.length < r) throw Error("AES-CCM frame is shorter than its authentication tag.");
	let i = t.length - r;
	return se(e, t.subarray(0, i), t.subarray(i), n);
}
function E(e, t) {
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
async function D(e, t, n) {
	let r = de([
		k(e, t.length),
		ue(e.additionalData),
		A(t)
	]), i = new Uint8Array(await n.encrypt({
		name: "AES-CBC",
		iv: new Uint8Array(T)
	}, e.key.cbc, N(r))), a = i.length - T;
	return i.slice(a - T, a - T + e.tagLength);
}
async function O(e, t, n) {
	let r = new Uint8Array(T);
	r[0] = e.lengthSize - 1, r.set(e.nonce, 1);
	let i = Math.ceil(t / T) + 1, a = await n.encrypt({
		name: "AES-CTR",
		counter: r,
		length: e.lengthSize * 8
	}, e.key.ctr, /* @__PURE__ */ new ArrayBuffer(i * T));
	return new Uint8Array(a);
}
function k(e, t) {
	let n = new Uint8Array(T);
	return n[0] = (e.additionalData.length > 0) * 64 + (e.tagLength - 2) / 2 * 8 + (e.lengthSize - 1), n.set(e.nonce, 1), j(n, T - e.lengthSize, t), n;
}
function ue(e) {
	if (e.length === 0) return /* @__PURE__ */ new Uint8Array();
	if (e.length >= 65280) throw TypeError("AES-CCM additional data above 65280 bytes is not supported.");
	let t = new Uint8Array(e.length + 2);
	return j(t, 0, e.length, 2), t.set(e, 2), A(t);
}
function A(e) {
	if (e.length % T === 0) return e;
	let t = new Uint8Array(Math.ceil(e.length / T) * T);
	return t.set(e), t;
}
function j(e, t, n, r = e.length - t) {
	let i = n;
	for (let n = r - 1; n >= 0; --n) e[t + n] = i & 255, i = Math.floor(i / 256);
}
function de(e) {
	let t = e.reduce((e, t) => e + t.length, 0), n = new Uint8Array(t), r = 0;
	for (let t of e) n.set(t, r), r += t.length;
	return n;
}
function M(e, t) {
	let n = new Uint8Array(e.length);
	for (let r = 0; r < e.length; r += 1) n[r] = (e[r] ?? 0) ^ (t[r] ?? 0);
	return n;
}
function fe(e, t) {
	if (e.length !== t.length) return !1;
	let n = 0;
	for (let r = 0; r < e.length; r += 1) n |= (e[r] ?? 0) ^ (t[r] ?? 0);
	return n === 0;
}
function N(e) {
	return e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength);
}
//#endregion
//#region src/ble/protocol.ts
var P = {
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
P.lock, P.unlock;
function F(e, t) {
	if (t.length !== 4) throw TypeError("Sesame session random code must be four bytes.");
	let n = /* @__PURE__ */ new Uint8Array(13);
	return new DataView(n.buffer).setBigInt64(0, BigInt(e), !0), n.set(t, 9), n;
}
var pe = 1, me = 2, he = 4;
function ge(e, t = 20) {
	let n = I(t), r = e.parsing === "cipher" ? he : me, i = [], a = Math.max(1, Math.ceil(e.data.length / n));
	for (let t = 0; t < a; t += 1) {
		let o = e.data.subarray(t * n, (t + 1) * n), s = (t === 0 ? pe : 0) | (t === a - 1 ? r : 0), c = new Uint8Array(o.length + 1);
		c[0] = s, c.set(o, 1), i.push(c);
	}
	return i;
}
function I(e) {
	if (!Number.isInteger(e) || e < 2) throw TypeError("Sesame BLE packet size must be an integer above one.");
	return e - 1;
}
//#endregion
//#region src/ble/keyholder-session.ts
var L = new Uint8Array([0]), R = 4, _e = 4;
async function z(e, t, n = crypto.subtle) {
	if (t.length !== 4) throw TypeError("Sesame session random code must be four bytes.");
	let r = await ne(e, t, n), i = await ae(r, n), a = r.slice(0, _e);
	return r.fill(0), {
		session: new ve(i, t, n),
		loginProof: a
	};
}
var ve = class {
	constructor(e, t, n) {
		this.randomCode = t, this.subtle = n, this.sentCount = 0, this.receivedCount = 0, this.closed = !1, this.key = e;
	}
	async seal(e) {
		let t = await ce({
			key: this.requireOpen(),
			nonce: F(this.sentCount, this.randomCode),
			additionalData: L,
			tagLength: R
		}, e, this.subtle);
		return this.sentCount += 1, ge({
			parsing: "cipher",
			data: t
		});
	}
	async open(e, t) {
		let n = this.requireOpen();
		if (e === "plain") return t;
		let r = await le({
			key: n,
			nonce: F(this.receivedCount, this.randomCode),
			additionalData: L,
			tagLength: R
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
}, ye = 4, be = class {
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
		let n = xe(t);
		switch (e) {
			case "isPaired": return this.backend.isPaired(B(n.deviceName, "deviceName"));
			case "pair": return this.backend.pair();
			case "startSession": return this.startSession(B(n.deviceName, "deviceName"), V(n.randomCode, "randomCode"));
			case "seal": return this.session(n).seal(V(n.message, "message"));
			case "open": return this.session(n).open(Se(n.parsing), V(n.data, "data"));
			case "closeSession": return this.closeSession(B(n.sessionId, "sessionId"));
			default: throw Error(`Unknown keyholder request: ${e}.`);
		}
	}
	async startSession(e, t) {
		if (this.sessions.size >= ye) throw Error("Too many Sesame sessions are open.");
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
		let t = B(e.sessionId, "sessionId"), n = this.sessions.get(t);
		if (n === void 0) throw Error("That Sesame session is not open.");
		return n;
	}
};
function xe(e) {
	return typeof e == "object" && e && !Array.isArray(e) ? e : {};
}
function B(e, t) {
	if (typeof e != "string" || e.length === 0) throw TypeError(`The ${t} is missing.`);
	return e;
}
function V(e, t) {
	if (e instanceof Uint8Array) return e;
	if (e instanceof ArrayBuffer) return new Uint8Array(e);
	throw TypeError(`The ${t} must be bytes.`);
}
function Se(e) {
	if (e === "plain" || e === "cipher") return e;
	throw TypeError("The parsing type must be plain or cipher.");
}
//#endregion
//#region src/keyholder/storage.ts
var Ce = "sesame-keyholder", H = "devices", we = 1, Te = class {
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
			let n = indexedDB.open(Ce, we);
			n.onupgradeneeded = () => {
				n.result.createObjectStore(H, { keyPath: "deviceName" });
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
			let a = t(n.transaction(H, e).objectStore(H));
			a.onsuccess = () => {
				r(a.result);
			}, a.onerror = () => {
				i(/* @__PURE__ */ Error("The keyholder could not reach its storage."));
			};
		});
	}
}, U = "AES-GCM", Ee = 12, De = class {
	constructor(e, t = crypto.subtle, n = (e) => crypto.getRandomValues(new Uint8Array(e))) {
		this.storage = e, this.subtle = t, this.randomBytes = n;
	}
	async pair(e, t, n, r) {
		let i = W(e), a = Oe(t.secret), o = await this.subtle.importKey("raw", K(a), { name: "AES-CBC" }, !0, ["encrypt"]);
		a.fill(0);
		let s = this.randomBytes(Ee), c = new Uint8Array(await this.subtle.wrapKey("raw", o, n, {
			name: U,
			iv: K(s)
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
		return await this.storage.put(l), G(l);
	}
	async protectionFor(e) {
		return (await this.require(W(e))).protection;
	}
	async unlock(e, t) {
		let n = await this.require(W(e));
		try {
			return await this.subtle.unwrapKey("raw", K(n.wrappedSecret), t, {
				name: U,
				iv: K(n.wrapIv)
			}, { name: "AES-CBC" }, !1, ["encrypt"]);
		} catch {
			throw Error("The key could not be unlocked. Use the same passkey or passphrase that paired it.");
		}
	}
	async has(e) {
		return await this.storage.get(W(e)) !== void 0;
	}
	async list() {
		return (await this.storage.list()).map(G);
	}
	async forget(e) {
		await this.storage.delete(W(e));
	}
	async require(e) {
		let t = await this.storage.get(e);
		if (t === void 0) throw Error(`No Sesame is paired as "${e}".`);
		return t;
	}
};
function W(e) {
	let t = e.trim().toLowerCase().replace(/\s+/gu, "-");
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(t)) throw TypeError("A device alias must start with a letter or digit and use only letters, digits, dot, dash, or underscore.");
	return t;
}
function G(e) {
	return {
		deviceName: e.deviceName,
		uuid: e.uuid,
		...e.level === void 0 ? {} : { level: e.level },
		pairedAt: e.pairedAt
	};
}
function Oe(e) {
	return Uint8Array.from(e.match(/.{2}/gu) ?? [], (e) => Number.parseInt(e, 16));
}
function K(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/keyholder/main.ts
var q = new De(new Te()), J = (e) => {
	let t = document.getElementById(e);
	if (t === null) throw Error(`The keyholder page is missing #${e}.`);
	return t;
}, Y = (e, t = "info") => {
	let n = J("status");
	n.textContent = e, n.dataset.kind = t;
}, ke = new be({
	isPaired: (e) => q.has(e),
	unlock: async (e) => {
		let t = await q.protectionFor(e);
		Y(t.kind === "webauthn-prf" ? `Confirm to unlock "${e}".` : `Enter the passphrase for "${e}".`);
		let n = await _(t, X), r = await q.unlock(e, n);
		return Y(`Session open for "${e}".`), r;
	},
	pair: async () => {
		throw Error("Open the keyholder page itself to pair a Sesame, then return to TurboWarp.");
	}
});
window.addEventListener("message", (e) => {
	let t = e.data, n = e.ports[0];
	t?.sesameKeyholder === 1 && n !== void 0 && (ke.listen(n), J("embedded").hidden = !1);
});
async function X() {
	let e = J("passphrase").value;
	if (e.length === 0) throw J("passphrase-row").hidden = !1, Error("Enter the passphrase above, then try again.");
	return Promise.resolve(e);
}
async function Z() {
	let e = J("devices"), t = await q.list();
	e.replaceChildren(...t.map((e) => Ae(e))), J("empty").hidden = t.length > 0;
}
function Ae(e) {
	let t = document.createElement("li"), n = document.createElement("strong");
	n.textContent = e.deviceName;
	let r = document.createElement("span");
	r.textContent = `${e.uuid}${e.level === void 0 ? "" : ` · ${e.level} key`}`;
	let i = document.createElement("button");
	return i.type = "button", i.textContent = "Forget", i.addEventListener("click", () => {
		(async () => {
			await q.forget(e.deviceName), Y(`Forgot "${e.deviceName}".`), await Z();
		})();
	}), t.append(n, r, i), t;
}
async function Q(e) {
	let t;
	try {
		t = n(e);
	} catch (e) {
		Y(e instanceof Error ? e.message : String(e), "error");
		return;
	}
	await $(t);
}
async function je() {
	let e;
	try {
		e = r({
			secret: J("manual-secret").value,
			uuid: J("manual-uuid").value
		});
	} catch (e) {
		Y(e instanceof Error ? e.message : String(e), "error");
		return;
	}
	await $(e), J("manual-secret").value = "";
}
async function $(e) {
	let t = W(J("alias").value || (e.name ?? "sesame")), n = p() && J("use-passkey").checked;
	try {
		if (n) {
			Y("Confirm with your passkey to protect this key.");
			let { credentialId: n, salt: r } = await m(t), i = await h(n, r);
			await q.pair(t, e, i, {
				kind: "webauthn-prf",
				credentialId: n,
				salt: r
			});
		} else {
			let n = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)), r = await g(await X(), n, u);
			await q.pair(t, e, r, {
				kind: "passphrase",
				salt: n,
				iterations: u
			});
		}
		Y(`Paired "${t}" (${i(e).uuid}).`), J("paste").value = "", J("passphrase").value = "", await Z();
	} catch (e) {
		Y(e instanceof Error ? e.message : String(e), "error");
	}
}
function Me() {
	J("scan").addEventListener("click", () => {
		(async () => {
			let e = J("preview");
			try {
				Y("Point the camera at the sharing QR code.");
				let t = await ee();
				e.srcObject = t.stream, e.hidden = !1, await e.play();
				let n = await t.result;
				e.hidden = !0, e.srcObject = null, await Q(n);
			} catch (t) {
				e.hidden = !0, e.srcObject = null, Y(t instanceof Error ? t.message : String(t), "error");
			}
		})();
	}), J("use-pasted").addEventListener("click", () => {
		Q(J("paste").value);
	}), J("use-manual").addEventListener("click", () => {
		je();
	}), J("use-passkey").addEventListener("change", () => {
		J("passphrase-row").hidden = J("use-passkey").checked;
	});
}
function Ne() {
	"serviceWorker" in navigator && navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}
async function Pe() {
	Me(), Ne();
	let e = p(), t = J("use-passkey");
	t.checked = e, t.disabled = !e, J("passphrase-row").hidden = e, J("no-passkeys").hidden = e, J("scan").hidden = !await b(), J("no-camera").hidden = !J("scan").hidden, await Z(), Y("Ready.");
}
Pe().catch((e) => {
	Y(e instanceof Error ? e.message : String(e), "error");
});
//#endregion
