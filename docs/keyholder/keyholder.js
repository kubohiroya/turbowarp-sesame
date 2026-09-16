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
	let s = u(i);
	if (s.length === 16) return o(s, r);
	let f = s[0];
	if (f === void 0) throw Error("This sesame QR code is empty.");
	if (f > 20) throw Error(`This sesame QR code is in a format this project does not know: ${a(s)}, parameters ${c(r)}. See docs/device-testing.md.`);
	let p = f >= 5 ? 4 : 64, m = 17 + p + 2 + 16;
	if (s.length !== m) throw Error(`This sesame QR code is ${s.length} bytes, but model ${f} needs ${m}. ${a(s)}, parameters ${c(r)}`);
	let h = 1, g = d(s, h, 16);
	if (g.startsWith(e)) throw Error("This is a guest key, which does not contain the half of the secret that Bluetooth needs. Share an owner or manager key instead.");
	h += 16;
	let _ = d(s, h, p);
	h += p;
	let v = d(s, h, 2);
	h += 2;
	let y = ee(s, h), b = l(r.get("l")), x = r.get("n") ?? void 0;
	return {
		model: f,
		secret: g,
		publicKey: _,
		keyIndex: v,
		uuid: y,
		...b === void 0 ? {} : { level: b },
		...x === void 0 || x.length === 0 ? {} : { name: x }
	};
}
function r(t) {
	let n = t.secret.trim().toLowerCase().replace(/\s+/gu, "");
	if (!/^[0-9a-f]{32}$/u.test(n)) throw Error("The secret key must be exactly 32 hexadecimal characters.");
	if (n.startsWith(e)) throw Error("That is a guest key's secret, which is missing the half Bluetooth needs. Use an owner or manager key.");
	let r = t.uuid?.trim() ?? "", i = r.length === 0 ? void 0 : r.toUpperCase();
	if (i !== void 0 && !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/u.test(i)) throw Error("The device UUID must look like 00000000-0000-0000-0000-000000000000, or be left empty.");
	let a = t.model ?? 5;
	if (!Number.isInteger(a) || a < 0 || a > 20) throw Error(`Unknown product model: ${String(a)}.`);
	let o = t.name?.trim();
	return {
		model: a,
		secret: n,
		publicKey: t.publicKey ?? "",
		keyIndex: "",
		...i === void 0 ? {} : { uuid: i },
		...o === void 0 || o.length === 0 ? {} : { name: o }
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
function o(t, n) {
	let r = s(n), i = d(t, 0, 16);
	if (i.startsWith(e)) throw Error("This is a guest key, which does not contain the half of the secret that Bluetooth needs. Share an owner or manager key instead.");
	let a = l(n.get("l")), o = n.get("n") ?? void 0, c = Number.parseInt(n.get("m") ?? "", 10);
	return {
		model: Number.isInteger(c) && c >= 0 && c <= 20 ? c : 5,
		secret: i,
		publicKey: "",
		keyIndex: "",
		...r === void 0 ? {} : { uuid: r },
		...a === void 0 ? {} : { level: a },
		...o === void 0 || o.length === 0 ? {} : { name: o }
	};
}
function s(e) {
	for (let [t, n] of e) {
		if (t === "sk") continue;
		let e = n.trim().replace(/-/gu, "");
		if (/^[0-9a-f]{32}$/iu.test(e)) {
			let t = e.toUpperCase();
			return [
				t.slice(0, 8),
				t.slice(8, 12),
				t.slice(12, 16),
				t.slice(16, 20),
				t.slice(20, 32)
			].join("-");
		}
	}
}
function c(e) {
	let t = [.../* @__PURE__ */ new Set([...e.keys()])];
	return t.length === 0 ? "(none)" : t.join(", ");
}
function l(e) {
	if (e === null) return;
	let n = Number.parseInt(e, 10);
	for (let [e, r] of Object.entries(t)) if (r === n) return e;
}
function u(e) {
	let t = e.replace(/ /gu, "+").replace(/-/gu, "+").replace(/_/gu, "/"), n;
	try {
		n = atob(t);
	} catch {
		throw Error("This sesame QR code is not valid base64.");
	}
	return Uint8Array.from(n, (e) => e.charCodeAt(0));
}
function d(e, t, n) {
	let r = "";
	for (let i = t; i < t + n; i += 1) r += (e[i] ?? 0).toString(16).padStart(2, "0");
	return r;
}
function ee(e, t) {
	let n = d(e, t, 16).toUpperCase();
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
var f = 6e5, p = {
	name: "AES-GCM",
	length: 256
}, m = new TextEncoder().encode("sesame-keyholder/kek/v1");
function h() {
	return globalThis.PublicKeyCredential !== void 0 && typeof navigator < "u" && typeof navigator.credentials?.get == "function";
}
async function g(e, t = crypto.subtle) {
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
async function _(e, t, n = crypto.subtle) {
	let r = (await navigator.credentials.get({ publicKey: {
		challenge: crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)),
		allowCredentials: [{
			type: "public-key",
			id: x(e)
		}],
		userVerification: "required",
		extensions: { prf: { eval: { first: x(t) } } }
	} }))?.getClientExtensionResults().prf?.results?.first;
	if (r === void 0) throw Error("This passkey did not return key material. Pair again with a passphrase.");
	return b(new Uint8Array(r), t, n);
}
async function v(e, t, n = f, r = crypto.subtle) {
	if (e.length < 8) throw TypeError("A passphrase must be at least eight characters.");
	let i = await r.importKey("raw", x(new TextEncoder().encode(e)), "PBKDF2", !1, ["deriveKey"]);
	return r.deriveKey({
		name: "PBKDF2",
		salt: x(t),
		iterations: n,
		hash: "SHA-256"
	}, i, p, !1, ["wrapKey", "unwrapKey"]);
}
async function y(e, t, n = crypto.subtle) {
	return e.kind === "webauthn-prf" ? _(e.credentialId, e.salt, n) : v(await t(), e.salt, e.iterations, n);
}
async function b(e, t, n) {
	let r = await n.importKey("raw", x(e), "HKDF", !1, ["deriveKey"]);
	return e.fill(0), n.deriveKey({
		name: "HKDF",
		hash: "SHA-256",
		salt: x(t),
		info: x(m)
	}, r, p, !1, ["wrapKey", "unwrapKey"]);
}
function x(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/keyholder/scan.ts
async function te() {
	let e = S();
	if (e === void 0) return !1;
	try {
		return (await e.getSupportedFormats?.() ?? ["qr_code"]).includes("qr_code");
	} catch {
		return !1;
	}
}
async function ne(e = 6e4, t = 200) {
	let n = S();
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
function S() {
	return globalThis.BarcodeDetector;
}
//#endregion
//#region src/aes-cmac.ts
var C = 16, re = 135;
async function ie(e, t, n = crypto.subtle) {
	let r = async (t) => {
		let r = await n.encrypt({
			name: "AES-CBC",
			iv: new Uint8Array(C)
		}, e, oe(t));
		return new Uint8Array(r).slice(0, C);
	}, i = new Uint8Array(C), a = w(await r(i)), o = w(a), s = Math.max(1, Math.ceil(t.length / C)), c = t.length > 0 && t.length % C === 0, l = i;
	for (let e = 0; e < s - 1; e += 1) {
		let n = t.slice(e * C, (e + 1) * C);
		l = await r(T(l, n));
	}
	let u = (s - 1) * C, d = c ? T(t.slice(u, u + C), a) : T(ae(t.slice(u)), o);
	return r(T(l, d));
}
function w(e) {
	let t = new Uint8Array(C), n = 0;
	for (let r = 15; r >= 0; --r) {
		let i = e[r] ?? 0;
		t[r] = i << 1 & 255 | n, n = i & 128 ? 1 : 0;
	}
	return n !== 0 && (t[15] = (t[15] ?? 0) ^ re), t;
}
function ae(e) {
	let t = new Uint8Array(C);
	return t.set(e), t[e.length] = 128, t;
}
function T(e, t) {
	let n = new Uint8Array(C);
	for (let r = 0; r < C; r += 1) n[r] = (e[r] ?? 0) ^ (t[r] ?? 0);
	return n;
}
function oe(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/ble/aes-ccm.ts
var E = 16;
async function se(e, t = crypto.subtle) {
	let n = N(e), [r, i] = await Promise.all([t.importKey("raw", n, { name: "AES-CBC" }, !1, ["encrypt"]), t.importKey("raw", n, { name: "AES-CTR" }, !1, ["encrypt"])]);
	return {
		cbc: r,
		ctr: i
	};
}
async function ce(e, t, n = crypto.subtle) {
	let r = D(e, t.length), i = await O(r, t, n), a = await k(r, t.length, n);
	return {
		ciphertext: M(t, a.subarray(E)),
		tag: M(i, a.subarray(0, r.tagLength))
	};
}
async function le(e, t, n, r = crypto.subtle) {
	let i = D(e, t.length);
	if (n.length !== i.tagLength) throw Error(`AES-CCM tag must be ${i.tagLength} bytes, received ${n.length}.`);
	let a = await k(i, t.length, r), o = M(t, a.subarray(E));
	if (!he(M(await O(i, o, r), a.subarray(0, i.tagLength)), n)) throw Error("AES-CCM authentication tag mismatch.");
	return o;
}
async function ue(e, t, n = crypto.subtle) {
	let { ciphertext: r, tag: i } = await ce(e, t, n), a = new Uint8Array(r.length + i.length);
	return a.set(r), a.set(i, r.length), a;
}
async function de(e, t, n = crypto.subtle) {
	let r = e.tagLength ?? 4;
	if (t.length < r) throw Error("AES-CCM frame is shorter than its authentication tag.");
	let i = t.length - r;
	return le(e, t.subarray(0, i), t.subarray(i), n);
}
function D(e, t) {
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
async function O(e, t, n) {
	let r = me([
		fe(e, t.length),
		pe(e.additionalData),
		A(t)
	]), i = new Uint8Array(await n.encrypt({
		name: "AES-CBC",
		iv: new Uint8Array(E)
	}, e.key.cbc, N(r))), a = i.length - E;
	return i.slice(a - E, a - E + e.tagLength);
}
async function k(e, t, n) {
	let r = new Uint8Array(E);
	r[0] = e.lengthSize - 1, r.set(e.nonce, 1);
	let i = Math.ceil(t / E) + 1, a = await n.encrypt({
		name: "AES-CTR",
		counter: r,
		length: e.lengthSize * 8
	}, e.key.ctr, /* @__PURE__ */ new ArrayBuffer(i * E));
	return new Uint8Array(a);
}
function fe(e, t) {
	let n = new Uint8Array(E);
	return n[0] = (e.additionalData.length > 0) * 64 + (e.tagLength - 2) / 2 * 8 + (e.lengthSize - 1), n.set(e.nonce, 1), j(n, E - e.lengthSize, t), n;
}
function pe(e) {
	if (e.length === 0) return /* @__PURE__ */ new Uint8Array();
	if (e.length >= 65280) throw TypeError("AES-CCM additional data above 65280 bytes is not supported.");
	let t = new Uint8Array(e.length + 2);
	return j(t, 0, e.length, 2), t.set(e, 2), A(t);
}
function A(e) {
	if (e.length % E === 0) return e;
	let t = new Uint8Array(Math.ceil(e.length / E) * E);
	return t.set(e), t;
}
function j(e, t, n, r = e.length - t) {
	let i = n;
	for (let n = r - 1; n >= 0; --n) e[t + n] = i & 255, i = Math.floor(i / 256);
}
function me(e) {
	let t = e.reduce((e, t) => e + t.length, 0), n = new Uint8Array(t), r = 0;
	for (let t of e) n.set(t, r), r += t.length;
	return n;
}
function M(e, t) {
	let n = new Uint8Array(e.length);
	for (let r = 0; r < e.length; r += 1) n[r] = (e[r] ?? 0) ^ (t[r] ?? 0);
	return n;
}
function he(e, t) {
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
var ge = 1, _e = 2, I = 4;
function ve(e, t = 20) {
	let n = ye(t), r = e.parsing === "cipher" ? I : _e, i = [], a = Math.max(1, Math.ceil(e.data.length / n));
	for (let t = 0; t < a; t += 1) {
		let o = e.data.subarray(t * n, (t + 1) * n), s = (t === 0 ? ge : 0) | (t === a - 1 ? r : 0), c = new Uint8Array(o.length + 1);
		c[0] = s, c.set(o, 1), i.push(c);
	}
	return i;
}
function ye(e) {
	if (!Number.isInteger(e) || e < 2) throw TypeError("Sesame BLE packet size must be an integer above one.");
	return e - 1;
}
//#endregion
//#region src/ble/keyholder-session.ts
var L = new Uint8Array([0]), R = 4, be = 4;
async function xe(e, t, n = crypto.subtle) {
	if (t.length !== 4) throw TypeError("Sesame session random code must be four bytes.");
	let r = await ie(e, t, n), i = await se(r, n), a = r.slice(0, be);
	return r.fill(0), {
		session: new Se(i, t, n),
		loginProof: a
	};
}
var Se = class {
	constructor(e, t, n) {
		this.randomCode = t, this.subtle = n, this.sentCount = 0, this.receivedCount = 0, this.closed = !1, this.key = e;
	}
	async seal(e) {
		let t = await ue({
			key: this.requireOpen(),
			nonce: F(this.sentCount, this.randomCode),
			additionalData: L,
			tagLength: R
		}, e, this.subtle);
		return this.sentCount += 1, ve({
			parsing: "cipher",
			data: t
		});
	}
	async open(e, t) {
		let n = this.requireOpen();
		if (e === "plain") return t;
		let r = await de({
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
}, Ce = 4, z = class {
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
		let n = we(t);
		switch (e) {
			case "isPaired": return this.backend.isPaired(B(n.deviceName, "deviceName"));
			case "pair": return this.backend.pair();
			case "startSession": return this.startSession(B(n.deviceName, "deviceName"), V(n.randomCode, "randomCode"));
			case "seal": return this.session(n).seal(V(n.message, "message"));
			case "open": return this.session(n).open(Te(n.parsing), V(n.data, "data"));
			case "closeSession": return this.closeSession(B(n.sessionId, "sessionId"));
			default: throw Error(`Unknown keyholder request: ${e}.`);
		}
	}
	async startSession(e, t) {
		if (this.sessions.size >= Ce) throw Error("Too many Sesame sessions are open.");
		let { session: n, loginProof: r } = await xe(await this.backend.unlock(e), t), i = `s${String(this.nextSessionId)}`;
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
function we(e) {
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
function Te(e) {
	if (e === "plain" || e === "cipher") return e;
	throw TypeError("The parsing type must be plain or cipher.");
}
//#endregion
//#region src/keyholder/storage.ts
var Ee = "sesame-keyholder", H = "devices", De = 1, Oe = class {
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
			let n = indexedDB.open(Ee, De);
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
}, U = "AES-GCM", ke = 12, Ae = class {
	constructor(e, t = crypto.subtle, n = (e) => crypto.getRandomValues(new Uint8Array(e))) {
		this.storage = e, this.subtle = t, this.randomBytes = n;
	}
	async pair(e, t, n, r) {
		let i = W(e), a = Me(t.secret), o = await this.subtle.importKey("raw", K(a), { name: "AES-CBC" }, !0, ["encrypt"]);
		a.fill(0);
		let s = this.randomBytes(ke), c = new Uint8Array(await this.subtle.wrapKey("raw", o, n, {
			name: U,
			iv: K(s)
		})), l = {
			deviceName: i,
			...t.uuid === void 0 ? {} : { uuid: t.uuid },
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
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(t)) throw TypeError(`"${e.trim()}" cannot be used as a device alias. It has to be typed identically into the project's block, so it is limited to letters, digits, dot, dash, and underscore, starting with a letter or digit — front-door, for example.`);
	return t;
}
function je(e) {
	let t = (e ?? "").trim().toLowerCase().replace(/\s+/gu, "-").replace(/[^a-z0-9._-]/gu, "").replace(/^[^a-z0-9]+/u, "").slice(0, 64);
	return t.length > 0 ? t : "sesame";
}
function G(e) {
	return {
		deviceName: e.deviceName,
		...e.uuid === void 0 ? {} : { uuid: e.uuid },
		...e.level === void 0 ? {} : { level: e.level },
		pairedAt: e.pairedAt
	};
}
function Me(e) {
	return Uint8Array.from(e.match(/.{2}/gu) ?? [], (e) => Number.parseInt(e, 16));
}
function K(e) {
	return e.slice().buffer;
}
//#endregion
//#region src/keyholder/main.ts
var q = new Ae(new Oe()), J = (e) => {
	let t = document.getElementById(e);
	if (t === null) throw Error(`The keyholder page is missing #${e}.`);
	return t;
}, Y = (e, t = "info") => {
	let n = J("status");
	n.textContent = e, n.dataset.kind = t;
}, Ne = new z({
	isPaired: (e) => q.has(e),
	unlock: async (e) => {
		let t = await q.protectionFor(e);
		Y(t.kind === "webauthn-prf" ? `Confirm to unlock "${e}".` : `Enter the passphrase for "${e}".`);
		let n = await y(t, X), r = await q.unlock(e, n);
		return Y(`Session open for "${e}".`), r;
	},
	pair: async () => {
		throw Error("Open the keyholder page itself to pair a Sesame, then return to TurboWarp.");
	}
});
window.addEventListener("message", (e) => {
	let t = e.data, n = e.ports[0];
	t?.sesameKeyholder === 1 && n !== void 0 && (Ne.listen(n), J("embedded").hidden = !1);
});
async function X() {
	let e = J("passphrase").value;
	if (e.length === 0) throw J("passphrase-row").hidden = !1, Error("Enter the passphrase above, then try again.");
	return Promise.resolve(e);
}
async function Z() {
	let e = J("devices"), t = await q.list();
	e.replaceChildren(...t.map((e) => Pe(e))), J("empty").hidden = t.length > 0;
}
function Pe(e) {
	let t = document.createElement("li"), n = document.createElement("strong");
	n.textContent = e.deviceName;
	let r = document.createElement("span");
	r.textContent = [e.uuid ?? "UUID not in the sharing code", ...e.level === void 0 ? [] : [`${e.level} key`]].join(" · ");
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
async function Fe() {
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
	let t = h() && J("use-passkey").checked;
	try {
		let n = J("alias").value.trim(), r = W(n.length > 0 ? n : je(e.name));
		if (t) {
			Y("Confirm with your passkey to protect this key.");
			let { credentialId: t, salt: n } = await g(r), i = await _(t, n);
			await q.pair(r, e, i, {
				kind: "webauthn-prf",
				credentialId: t,
				salt: n
			});
		} else {
			let t = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)), n = await v(await X(), t, f);
			await q.pair(r, e, n, {
				kind: "passphrase",
				salt: t,
				iterations: f
			});
		}
		let a = i(e).uuid;
		Y(a === void 0 ? `Paired "${r}". The sharing code carried no device UUID, which Bluetooth does not need.` : `Paired "${r}" (${a}).`), J("paste").value = "", J("passphrase").value = "", await Z();
	} catch (e) {
		Y(e instanceof Error ? e.message : String(e), "error");
	}
}
var Ie = (e) => document.getElementById(e) ?? void 0;
function Le() {
	J("scan").addEventListener("click", () => {
		(async () => {
			let e = J("preview");
			try {
				Y("Point the camera at the sharing QR code.");
				let t = await ne();
				e.srcObject = t.stream, e.hidden = !1, await e.play();
				let n = await t.result;
				e.hidden = !0, e.srcObject = null, await Q(n);
			} catch (t) {
				e.hidden = !0, e.srcObject = null, Y(t instanceof Error ? t.message : String(t), "error");
			}
		})();
	}), J("use-pasted").addEventListener("click", () => {
		Q(J("paste").value);
	}), Ie("use-manual")?.addEventListener("click", () => {
		Fe();
	}), J("use-passkey").addEventListener("change", () => {
		J("passphrase-row").hidden = J("use-passkey").checked;
	});
}
function Re() {
	"serviceWorker" in navigator && navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}
async function ze() {
	Le(), Re();
	let e = h(), t = J("use-passkey");
	t.checked = e, t.disabled = !e, J("passphrase-row").hidden = e, J("no-passkeys").hidden = e, J("scan").hidden = !await te(), J("no-camera").hidden = !J("scan").hidden, await Z(), Y("Ready.");
}
ze().catch((e) => {
	Y(e instanceof Error ? e.message : String(e), "error");
});
//#endregion
